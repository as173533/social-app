import ipaddress
import socket
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen


MAX_PREVIEW_BYTES = 512 * 1024


class PreviewParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title_parts: list[str] = []
        self.in_title = False
        self.meta: dict[str, str] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() == "title":
            self.in_title = True
            return
        if tag.lower() != "meta":
            return
        values = {key.lower(): value for key, value in attrs if value}
        key = values.get("property") or values.get("name")
        content = values.get("content")
        if key and content:
            self.meta[key.lower()] = content.strip()

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "title":
            self.in_title = False

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.title_parts.append(data)


def validate_public_http_url(url: str) -> str:
    parsed = urlparse(url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Only http and https URLs are supported")
    host = parsed.hostname
    if not host:
        raise ValueError("URL host is required")
    for info in socket.getaddrinfo(host, None):
        address = ipaddress.ip_address(info[4][0])
        if address.is_private or address.is_loopback or address.is_link_local or address.is_multicast or address.is_reserved:
            raise ValueError("Private network URLs are not supported")
    return parsed.geturl()


def clean_text(value: str | None, limit: int) -> str | None:
    if not value:
        return None
    text = " ".join(value.split())
    return text[:limit] if text else None


def fetch_link_preview(url: str) -> dict[str, str | None]:
    safe_url = validate_public_http_url(url)
    request = Request(safe_url, headers={"User-Agent": "ChatMessengerBot/1.0"})
    with urlopen(request, timeout=4) as response:
        content_type = response.headers.get("content-type", "")
        body = response.read(MAX_PREVIEW_BYTES)
    parsed = urlparse(safe_url)
    if content_type.startswith("image/"):
        return {
            "url": safe_url,
            "title": parsed.netloc,
            "description": None,
            "image": safe_url,
            "site_name": parsed.netloc,
        }
    parser = PreviewParser()
    parser.feed(body.decode("utf-8", errors="ignore"))
    title = parser.meta.get("og:title") or parser.meta.get("twitter:title") or "".join(parser.title_parts)
    description = parser.meta.get("og:description") or parser.meta.get("description") or parser.meta.get("twitter:description")
    image = parser.meta.get("og:image") or parser.meta.get("twitter:image")
    return {
        "url": safe_url,
        "title": clean_text(title, 140) or parsed.netloc,
        "description": clean_text(description, 240),
        "image": urljoin(safe_url, image) if image else None,
        "site_name": clean_text(parser.meta.get("og:site_name"), 80) or parsed.netloc,
    }
