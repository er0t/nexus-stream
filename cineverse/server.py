import json
import logging
import os
import re
from typing import Optional
from urllib.parse import quote, unquote
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
import httpx
import uvicorn

from client import MovieBoxClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("CineVerseServer")

app = FastAPI(title="CineVerse Streaming Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = MovieBoxClient()

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(STATIC_DIR, exist_ok=True)


@app.get("/api/home")
def get_home():
    """Returns curated carousel categories and hero showcase items from home feed."""
    try:
        raw = client.get_home_feed()
        op_list = raw.get("data", {}).get("operatingList", [])

        curated = []
        hero_items = []

        for section in op_list:
            title = section.get("title", "").strip()
            subjects = section.get("subjects", [])
            if not subjects or not title:
                continue

            clean_subjects = []
            for s in subjects:
                if s.get("hasResource") is False:
                    continue  # Skip unreleased titles without streams
                cover = s.get("cover", {})
                img_url = cover.get("url") if isinstance(cover, dict) else s.get("cover")
                clean_subjects.append({
                    "id": str(s.get("subjectId")),
                    "title": s.get("title"),
                    "cover": img_url,
                    "releaseDate": s.get("releaseDate", ""),
                    "genre": s.get("genre", ""),
                    "duration": s.get("duration", 0),
                    "detailPath": s.get("detailPath", ""),
                    "hasResource": s.get("hasResource", True),
                    "subjectType": s.get("subjectType", 1),
                })

            if clean_subjects:
                curated.append({
                    "title": title,
                    "category": section.get("category", title),
                    "items": clean_subjects,
                })
                if not hero_items and len(clean_subjects) >= 3:
                    hero_items = clean_subjects[:5]

        return {
            "status": "success",
            "hero": hero_items,
            "sections": curated[:16],
        }
    except Exception as e:
        logger.error(f"Error fetching home feed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/search")
def search(q: str = Query(..., min_length=1), page: int = 1, pageSize: int = 30):
    """Searches the movie and series catalog."""
    try:
        raw = client.search(keyword=q, page=page, page_size=pageSize)
        data = raw.get("data", {})
        items = data.get("items", [])

        results = []
        for s in items:
            cover = s.get("cover", {})
            img_url = cover.get("url") if isinstance(cover, dict) else s.get("cover")
            results.append({
                "id": str(s.get("subjectId")),
                "title": s.get("title"),
                "cover": img_url,
                "releaseDate": s.get("releaseDate", ""),
                "genre": s.get("genre", ""),
                "duration": s.get("duration", 0),
                "detailPath": s.get("detailPath", ""),
                "subjectType": s.get("subjectType", 1),
            })

        return {
            "status": "success",
            "query": q,
            "total": data.get("pager", {}).get("totalCount", len(results)),
            "items": results,
        }
    except Exception as e:
        logger.error(f"Search failed for '{q}': {e}")
        raise HTTPException(status_code=500, detail=str(e))


def extract_ep_number(item, index=0):
    for key in ("episodeNumber", "episode", "ep", "num"):
        if item.get(key) is not None:
            try:
                val = int(item[key])
                if val > 0:
                    return val
            except (ValueError, TypeError):
                pass
    s_text = str(item.get("name") or item.get("title") or "")
    m1 = re.search(r'(?:E|EP|Episode|\d+x)[.\s_-]*(\d+)', s_text, re.IGNORECASE)
    if m1:
        return int(m1.group(1))
    m2 = re.search(r'^(\d+)[.\s_-]', s_text)
    if m2:
        return int(m2.group(1))
    return index + 1


@app.get("/api/detail/{subject_id}")
def get_detail(subject_id: str):
    """Fetches comprehensive detail for a movie or TV show, accurately classifying
    series versus single movies.
    """
    try:
        raw = client.get_detail(subject_id=subject_id)
        raw_payload = raw.get("data", {})
        print("RAW EPISODES PAYLOAD:", json.dumps(raw_payload, indent=2))

        data = raw_payload
        subject = data.get("subject", {})
        metadata = data.get("metadata", {})

        cover = subject.get("cover", {})
        img_url = cover.get("url") if isinstance(cover, dict) else subject.get("cover")

        raw_stars = data.get("stars", []) or subject.get("stars", [])
        stars = [
            {
                "name": star.get("name"),
                "character": star.get("character") or "",
                "avatar": star.get("avatarUrl") or star.get("avatar") or "",
            }
            for star in raw_stars[:12]
        ]

        # Check if actually a Series (raw subjectType == 2 AND has real multiple episodes/seasons)
        raw_subject_type = subject.get("subjectType", 1)
        raw_seasons = data.get("resource", {}).get("seasons", []) or data.get("seasons", [])
        has_real_seasons = False
        if raw_seasons and raw_subject_type != 1:
            has_real_seasons = any(
                s.get("se", 0) > 0 or s.get("maxEp", 0) > 1 or (s.get("allEp") and "," in str(s.get("allEp")))
                for s in raw_seasons
            )
        is_series = (raw_subject_type == 2) and has_real_seasons

        seasons = []
        if is_series:
            for s in raw_seasons:
                se_num = s.get("se", 0)
                max_ep = s.get("maxEp", 0)
                # Ignore dummy movie placeholder
                if se_num == 0 and max_ep == 0:
                    continue

                se_num = max(1, se_num)
                all_ep_str = s.get("allEp", "")

                parsed_nums = []
                if all_ep_str:
                    for token in re.findall(r'\d+', str(all_ep_str)):
                        try:
                            parsed_nums.append(int(token))
                        except ValueError:
                            pass

                # Check if explicit episode objects exist in the payload
                raw_ep_list = s.get("episodes") or s.get("episodeList") or []
                ep_map = {}
                for idx, ep_item in enumerate(raw_ep_list):
                    if isinstance(ep_item, dict):
                        ep_idx = extract_ep_number(ep_item, idx)
                        if ep_idx > 0:
                            parsed_nums.append(ep_idx)
                            title = ep_item.get("title") or ep_item.get("name") or f"Episode {ep_idx}"
                            ep_map[ep_idx] = title

                highest_ep = max([max_ep] + parsed_nums) if ([max_ep] + parsed_nums) else 1
                highest_ep = max(1, highest_ep)

                # Recover all episodes sequentially from 1 to highest_ep
                # Never drop an episode card even if upstream stream URLs or metadata are missing
                episodes = []
                for ep_num in range(1, highest_ep + 1):
                    episodes.append({
                        "episode": ep_num,
                        "title": ep_map.get(ep_num, f"Episode {ep_num}"),
                        "season": se_num,
                    })

                episodes.sort(key=lambda x: int(x["episode"]))

                season_dict = {
                    "season": se_num,
                    "episodes": episodes,
                    "maxEp": highest_ep,
                }
                if s.get("subjectId"):
                    season_dict["subjectId"] = str(s["subjectId"])
                seasons.append(season_dict)

            seasons.sort(key=lambda x: int(x["season"]))

        description = (
            subject.get("description")
            or metadata.get("description")
            or "No synopsis available."
        )

        return {
            "status": "success",
            "subject": {
                "id": str(subject.get("subjectId")),
                "title": subject.get("title") or metadata.get("title"),
                "description": description,
                "cover": img_url,
                "releaseDate": subject.get("releaseDate"),
                "genre": subject.get("genre"),
                "country": subject.get("country"),
                "duration": subject.get("duration"),
                "detailPath": subject.get("detailPath"),
                "subjectType": 2 if is_series else 1,
                "score": subject.get("score") or subject.get("imdbRating") or "8.4",
                "stars": stars,
            },
            "seasons": seasons,
        }
    except Exception as e:
        logger.error(f"Failed to fetch detail for {subject_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/play/{subject_id}")
def get_play(
    subject_id: str,
    season: int = 0,
    episode: int = 0,
    detailPath: Optional[str] = None,
):
    """Resolves stream sources with BIDIRECTIONAL auto-fallback (movie vs series)

    and multi-language subtitles.
    """
    try:
        if not detailPath:
            try:
                detail = client.get_detail(subject_id)
                sub_meta = detail.get("data", {}).get("subject", {})
                detailPath = sub_meta.get("detailPath")
            except Exception:
                detailPath = None

        # 1. First attempt with requested season & episode
        raw = client.get_playback(
            subject_id=subject_id,
            season=season,
            episode=episode,
            detail_path=detailPath,
        )
        data = raw.get("data", {})
        streams = data.get("streams", [])

        # 2. If 0 streams and requested (1, 1), retry with Movie mode (0, 0)
        if not streams and (season == 1 and episode == 1):
            logger.info(f"0 streams for {subject_id} with s={season}, ep={episode}. Falling back to Movie mode (s=0, ep=0)...")
            raw_fallback = client.get_playback(
                subject_id=subject_id,
                season=0,
                episode=0,
                detail_path=detailPath,
            )
            fallback_data = raw_fallback.get("data", {})
            if fallback_data.get("streams"):
                data = fallback_data
                streams = data.get("streams", [])
                season, episode = 0, 0

        # 3. If 0 streams and requested (0, 0), retry with Series mode (1, 1)
        elif not streams and season == 0 and episode == 0:
            logger.info(f"0 streams for {subject_id} with s=0, ep=0. Falling back to Series mode (s=1, ep=1)...")
            raw_fallback = client.get_playback(
                subject_id=subject_id,
                season=1,
                episode=1,
                detail_path=detailPath,
            )
            fallback_data = raw_fallback.get("data", {})
            if fallback_data.get("streams"):
                data = fallback_data
                streams = data.get("streams", [])
                season, episode = 1, 1

        # 4. Multi-source alternate fallback for unavailable series episodes (e.g., Breaking Bad S1 E3)
        if not streams and (season > 0 and episode > 0):
            logger.info(f"0 streams for {subject_id} S{season}E{episode}. Searching for alternate catalog sources...")
            title_kw = None
            if detailPath:
                slug = re.sub(r'-[a-zA-Z0-9]+$', '', detailPath)
                title_kw = slug.replace('-', ' ').strip()
            if not title_kw:
                try:
                    det = client.get_detail(subject_id)
                    title_kw = det.get("data", {}).get("subject", {}).get("title", "")
                except Exception:
                    pass

            if title_kw:
                clean_kw = re.sub(r'(?i)\s+S\d+.*$', '', title_kw).strip()
                try:
                    search_res = client.search(clean_kw)
                    candidates = search_res.get("data", {}).get("items", [])
                    for cand in candidates:
                        alt_id = str(cand.get("subjectId"))
                        if alt_id and alt_id != str(subject_id):
                            alt_detail_path = cand.get("detailPath")
                            alt_raw = client.get_playback(
                                subject_id=alt_id,
                                season=season,
                                episode=episode,
                                detail_path=alt_detail_path,
                            )
                            alt_data = alt_raw.get("data", {})
                            if alt_data.get("streams"):
                                logger.info(f"Resolved alternate source {alt_id} for S{season}E{episode}!")
                                data = alt_data
                                streams = data.get("streams", [])
                                detailPath = alt_detail_path
                                break
                except Exception as e:
                    logger.warning(f"Alternate source lookup error: {e}")

        clean_streams = []
        for s in streams:
            raw_url = s.get("url")
            res = s.get("resolutions") or s.get("resolution") or "Auto"
            fmt = s.get("format") or "MP4"
            if raw_url:
                clean_streams.append({
                    "resolution": res,
                    "format": fmt,
                    "raw_url": raw_url,
                    "stream_url": f"/api/proxy-stream?url={quote(raw_url, safe='')}",
                    "vipLocked": s.get("vipLocked", False),
                })

        # Fetch multi-language subtitles
        clean_captions = []
        if streams:
            try:
                first_stream = streams[0]
                cap_res = client.get_captions(
                    subject_id=subject_id,
                    stream_id=str(first_stream.get("id")),
                    stream_format=first_stream.get("format", "MP4"),
                    detail_path=detailPath,
                )
                raw_caps = cap_res.get("data", {}).get("captions", [])
                for c in raw_caps:
                    cap_url = c.get("url")
                    if cap_url:
                        lan_name = c.get("lanName") or c.get("lan", "English")
                        clean_captions.append({
                            "id": str(c.get("id")),
                            "lang": c.get("lan", "en"),
                            "label": lan_name,
                            "url": f"/api/proxy-subtitle?url={quote(cap_url, safe='')}",
                        })
                logger.info(f"Resolved {len(clean_captions)} subtitles for {subject_id}")
            except Exception as ce:
                logger.warning(f"Failed to fetch captions: {ce}")

        has_resource = len(clean_streams) > 0 and data.get("hasResource", True)
        return {
            "status": "success" if has_resource else "no_stream",
            "hasResource": has_resource,
            "streams": clean_streams,
            "captions": clean_captions,
            "resolvedSeason": season,
            "resolvedEpisode": episode,
            "playConfig": data.get("playConfig", {}),
        }
    except Exception as e:
        logger.error(f"Playback resolution failed for {subject_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/proxy-stream")
async def proxy_stream(request: Request, url: Optional[str] = None):
    """Proxies Hakuna CDN MP4 streams with Range header support and proper Referer bypass."""
    raw_query = str(request.query_params)
    target_url = ""

    if "url=" in raw_query:
        idx = raw_query.find("url=") + 4
        target_url = unquote(raw_query[idx:])
    elif url:
        target_url = unquote(url)

    if not target_url.startswith("http"):
        raise HTTPException(status_code=400, detail="Invalid stream URL")

    req_headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Referer": "https://movie-box.co/",
        "Origin": "https://movie-box.co",
    }

    range_header = request.headers.get("range")
    if range_header:
        req_headers["Range"] = range_header

    client_http = httpx.AsyncClient(timeout=60.0, follow_redirects=True)

    try:
        req = client_http.build_request("GET", target_url, headers=req_headers)
        response = await client_http.send(req, stream=True)

        resp_headers = {
            "Accept-Ranges": "bytes",
            "Content-Type": response.headers.get("Content-Type", "video/mp4"),
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Range",
        }
        if "Content-Range" in response.headers:
            resp_headers["Content-Range"] = response.headers["Content-Range"]
        if "Content-Length" in response.headers:
            resp_headers["Content-Length"] = response.headers["Content-Length"]

        async def stream_generator():
            try:
                async for chunk in response.aiter_bytes(chunk_size=128 * 1024):
                    yield chunk
            finally:
                await response.aclose()
                await client_http.aclose()

        return StreamingResponse(
            stream_generator(),
            status_code=response.status_code,
            headers=resp_headers,
        )
    except Exception as e:
        await client_http.aclose()
        logger.error(f"Streaming proxy exception: {e}")
        raise HTTPException(status_code=502, detail=f"CDN streaming error: {str(e)}")


@app.get("/api/proxy-subtitle")
async def proxy_subtitle(request: Request, url: Optional[str] = None):
    """Fetches SRT subtitles from CDN, converts them to standard WebVTT format,

    and delivers them with text/vtt headers for native browser and Android player display.
    """
    raw_query = str(request.query_params)
    target_url = ""

    if "url=" in raw_query:
        idx = raw_query.find("url=") + 4
        target_url = unquote(raw_query[idx:])
    elif url:
        target_url = unquote(url)

    if not target_url.startswith("http"):
        raise HTTPException(status_code=400, detail="Invalid subtitle URL")

    req_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://movie-box.co/",
    }

    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as http_c:
        try:
            res = await http_c.get(target_url, headers=req_headers)
            if res.status_code != 200:
                raise HTTPException(status_code=res.status_code, detail="Subtitle fetch error")

            raw_text = res.text.replace("\r\n", "\n").replace("\r", "\n").strip()
            if not raw_text.startswith("WEBVTT"):
                vtt_body = re.sub(r'(\d{2}:\d{2}:\d{2}),(\d{3})', r'\1.\2', raw_text)
                vtt_content = f"WEBVTT\n\n{vtt_body}"
            else:
                vtt_content = raw_text

            return Response(
                content=vtt_content,
                media_type="text/vtt; charset=utf-8",
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Cache-Control": "public, max-age=86400",
                },
            )
        except Exception as e:
            logger.error(f"Subtitle proxy error: {e}")
            raise HTTPException(status_code=502, detail=f"Subtitle conversion error: {str(e)}")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def root():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.get("/style.css")
def get_style():
    return FileResponse(os.path.join(STATIC_DIR, "style.css"))


@app.get("/app.js")
def get_script():
    return FileResponse(os.path.join(STATIC_DIR, "app.js"))


@app.get("/spatial-nav.js")
def get_spatial_nav():
    return FileResponse(os.path.join(STATIC_DIR, "spatial-nav.js"))


@app.get("/nexus_logo.png")
def get_logo():
    return FileResponse(os.path.join(STATIC_DIR, "nexus_logo.png"))


@app.get("/api/ad-config")
def get_ad_config():
    return {
        "ads_enabled": True,
        "cooldown_minutes": 6,
        "startapp_app_id": "208405542",
    }


@app.get("/api/version")
def get_version():
    return {
        "versionCode": 5,
        "versionName": "1.3.0",
        "minVersionCode": 1,
        "releaseNotes": [
            "Fixed uneven image sizes: uniform 3-column mobile poster grid",
            "Enforced strict 2:3 aspect-ratio across all Movies, Series, and Rails",
            "Brand new package identity com.nexustv.stream (clears Play Protect block)",
            "Integrated Android network security config & clean RSA release keystore",
            "Automatic fallback gradient prevents broken image text"
        ],
        "downloadUrl": "/download",
        "fileSize": "6.44 MB",
        "forceUpdate": False,
    }


@app.head("/download")
@app.head("/download-apk")
@app.get("/download")
@app.get("/download-apk")
def download_hd_apk():
    candidates = [
        os.path.join(os.path.dirname(__file__), "NexusHD.apk"),
        os.path.join(os.path.dirname(__file__), "..", "NexusHD.apk"),
        r"C:\Users\ouss\.gemini\antigravity-ide\scratch\nexus-hd\NexusHD.apk",
        r"C:\Users\ouss\.gemini\antigravity-ide\scratch\nexus-hd\android\app\build\outputs\apk\debug\app-debug.apk",
    ]
    existing = [c for c in candidates if os.path.exists(c)]
    if existing:
        target = max(existing, key=os.path.getmtime)
        return FileResponse(
            target,
            media_type="application/vnd.android.package-archive",
            filename="NexusHD.apk",
            headers={
                "Content-Disposition": 'attachment; filename="NexusHD.apk"',
                "Cache-Control": "no-cache, no-store, must-revalidate",
            },
        )
    raise HTTPException(status_code=404, detail="NexusHD APK not found")


@app.head("/download-tv")
@app.get("/download-tv")
def download_tv_apk():
    candidates = [
        os.path.join(os.path.dirname(__file__), "NexusTV.apk"),
        os.path.join(os.path.dirname(__file__), "..", "NexusTV.apk"),
        r"C:\Users\ouss\.gemini\antigravity-ide\scratch\cineverse-tv\NexusTV.apk",
        r"C:\Users\ouss\.gemini\antigravity-ide\scratch\cineverse-tv\android\app\build\outputs\apk\debug\app-debug.apk",
        r"C:\Users\ouss\.gemini\antigravity-ide\scratch\cineverse-android\NexusTV.apk",
    ]
    existing = [c for c in candidates if os.path.exists(c)]
    if existing:
        target = max(existing, key=os.path.getmtime)
        return FileResponse(
            target,
            media_type="application/vnd.android.package-archive",
            filename="NexusTV.apk",
            headers={
                "Content-Disposition": 'attachment; filename="NexusTV.apk"',
                "Cache-Control": "no-cache, no-store, must-revalidate",
            },
        )
    raise HTTPException(status_code=404, detail="NexusTV APK not found")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)
