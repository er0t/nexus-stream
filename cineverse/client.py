import hashlib
import json
import logging
import time
from typing import Any, Dict, List, Optional
import requests

logger = logging.getLogger("CineVerseClient")


class MovieBoxClient:
    """Client for the AOneRoom / MovieBox H5 BFF service.
    Implements dynamic guest session token bootstrapping, catalog search,
    detail extraction, and stream manifest resolution.
    """

    BASE_URL = "https://h5-api.aoneroom.com/wefeed-h5api-bff"
    REFERER_BASE = "https://themoviebox.xyz"

    def __init__(self, timeout: int = 15):
        self.timeout = timeout
        self.session = requests.Session()
        self._token: Optional[str] = None
        self._user_id: Optional[str] = None
        self._token_time: float = 0

    @staticmethod
    def _get_client_token() -> str:
        """Generates dynamic X-Client-Token: <epoch_secs>,<md5(reversed)>"""
        ts = str(int(time.time()))
        rev_md5 = hashlib.md5(ts[::-1].encode("utf-8")).hexdigest()
        return f"{ts},{rev_md5}"

    def _base_headers(self, referer: Optional[str] = None) -> Dict[str, str]:
        return {
            "Accept": "application/json",
            "Origin": self.REFERER_BASE,
            "Referer": referer or f"{self.REFERER_BASE}/",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "X-Client-Info": json.dumps({"timezone": "UTC"}),
            "X-Client-Token": self._get_client_token(),
            "X-Family-Mode": "0",
            "X-Language": "en",
        }

    def bootstrap(self, force: bool = False) -> str:
        """Handshake with /home to obtain a valid session JWT token."""
        # 45 minute cached validity
        if self._token and not force and (time.time() - self._token_time < 2700):
            return self._token

        logger.info("Handshaking with H5 BFF to obtain guest session token...")
        self.session.cookies.clear()
        res = self.session.get(
            f"{self.BASE_URL}/home",
            headers=self._base_headers(),
            timeout=self.timeout,
        )
        res.raise_for_status()

        x_user = res.headers.get("x-user") or res.headers.get("X-User")
        if not x_user:
            raise RuntimeError("Missing 'x-user' header in bootstrap response.")

        user_data = json.loads(x_user)
        self._token = user_data["token"]
        self._user_id = user_data.get("userId")
        self._token_time = time.time()
        logger.info(f"Acquired guest token for UID {self._user_id}")
        return self._token

    def _auth_request(
        self,
        method: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        json_data: Optional[Dict[str, Any]] = None,
        referer: Optional[str] = None,
    ) -> requests.Response:
        """Executes an authenticated request with auto-retry on 401/403."""
        for attempt in range(2):
            token = self.bootstrap(force=(attempt > 0))
            headers = self._base_headers(referer=referer)
            headers["Authorization"] = f"Bearer {token}"
            if json_data is not None:
                headers["Content-Type"] = "application/json"

            url = f"{self.BASE_URL}{path}"
            res = self.session.request(
                method=method,
                url=url,
                params=params,
                json=json_data,
                headers=headers,
                timeout=self.timeout,
            )

            if res.status_code in (401, 403) and attempt == 0:
                logger.warning(f"Got {res.status_code}, refreshing token and retrying...")
                self._token = None
                continue

            return res

        return res

    def get_home_feed(self) -> Dict[str, Any]:
        """Fetches operating list categories and banner items."""
        token = self.bootstrap()
        headers = self._base_headers()
        headers["Authorization"] = f"Bearer {token}"
        res = self.session.get(f"{self.BASE_URL}/home", headers=headers, timeout=self.timeout)
        res.raise_for_status()
        return res.json()

    def search(self, keyword: str, page: int = 1, page_size: int = 24) -> Dict[str, Any]:
        """Searches titles by keyword."""
        payload = {"keyword": keyword, "pageNum": page, "pageSize": page_size}
        res = self._auth_request("POST", "/subject/search", json_data=payload)
        res.raise_for_status()
        return res.json()

    def get_detail(self, subject_id: str) -> Dict[str, Any]:
        """Gets title synopsis, genres, cast, and episode/season lists."""
        res = self._auth_request("GET", "/detail", params={"subjectId": subject_id})
        res.raise_for_status()
        return res.json()

    def get_playback(
        self,
        subject_id: str,
        season: int = 0,
        episode: int = 0,
        detail_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Resolves direct stream links (hakunaymatata CDN) with quality variations."""
        params = {
            "subjectId": subject_id,
            "se": season,
            "ep": episode,
            "streamSignType": 1,
        }
        if detail_path:
            params["detailPath"] = detail_path

        referer = f"{self.REFERER_BASE}/movies/{detail_path}" if detail_path else f"{self.REFERER_BASE}/"
        res = self._auth_request("GET", "/subject/play", params=params, referer=referer)
        res.raise_for_status()
        return res.json()

    def get_captions(
        self,
        subject_id: str,
        stream_id: str,
        stream_format: str = "MP4",
        detail_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Resolves multi-language subtitles for a stream."""
        params = {
            "subjectId": subject_id,
            "id": stream_id,
            "format": stream_format,
        }
        if detail_path:
            params["detailPath"] = detail_path

        referer = f"{self.REFERER_BASE}/movies/{detail_path}" if detail_path else f"{self.REFERER_BASE}/"
        res = self._auth_request("GET", "/subject/caption", params=params, referer=referer)
        res.raise_for_status()
        return res.json()

