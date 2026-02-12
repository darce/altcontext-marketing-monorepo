import argparse
import time
from pathlib import Path
from typing import Final

import requests
from duckduckgo_search import DDGS

# Default constants
DEFAULT_MIN_WIDTH: Final[int] = 1000
DEFAULT_MIN_HEIGHT: Final[int] = 1000
DEFAULT_IMAGE_COUNT: Final[int] = 1

# Common headers to avoid 403 Forbidden errors
DEFAULT_HEADERS: Final[dict[str, str]] = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

def download_image(url: str, dest_path: Path) -> bool:
    """Download an image from a URL to a destination Path."""
    try:
        response = requests.get(url, headers=DEFAULT_HEADERS, timeout=15)
        response.raise_for_status()
        
        # Verify content type
        content_type = response.headers.get("content-type", "")
        if "image" not in content_type:
            return False
            
        dest_path.write_bytes(response.content)
        return True
    except Exception as e:
        print(f"  [!] Failed to download {url}: {e}")
        return False

def get_extension_from_url(url: str) -> str:
    """Pure function to extract a clean extension from a URL."""
    ext = url.split('.')[-1].split('?')[0].lower()
    if len(ext) > 4 or not ext.isalnum():
        return "jpg"
    return ext

def fetch_images(
    keywords_file: Path,
    min_width: int,
    min_height: int,
    num_images: int,
    output_dir: Path,
    verbose: bool = False
) -> None:
    """Search and download images for keywords defined in a CSV/Text file."""
    if not keywords_file.exists():
        raise FileNotFoundError(f"Keywords file not found: {keywords_file}")

    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Deterministic read
    text = keywords_file.read_text(encoding="utf-8")
    keywords = sorted(list(set(
        line.strip().strip(',') 
        for line in text.splitlines() 
        if line.strip() and line.strip().lower() != 'keyword'
    )))

    if verbose:
        print(f"Keywords to process: {len(keywords)}")

    with DDGS() as ddgs:
        for keyword in keywords:
            print(f"Searching for: {keyword}...")
            count = 0
            
            try:
                # Use large size for high quality
                results = ddgs.images(
                    keyword,
                    region="wt-wt",
                    safesearch="moderate",
                    size="large",
                )
                
                if not results:
                    print(f"  [!] No results for '{keyword}'")
                    continue

                for r in results:
                    if count >= num_images:
                        break
                    
                    url = r.get('image')
                    if not url:
                        continue
                        
                    width = int(r.get('width', 0))
                    height = int(r.get('height', 0))
                    
                    if width >= min_width and height >= min_height:
                        ext = get_extension_from_url(url)
                        safe_name = keyword.replace(' ', '_').lower()
                        filename = f"{safe_name}_{count + 1}.{ext}"
                        dest_path = output_dir / filename
                        
                        if download_image(url, dest_path):
                            if verbose:
                                print(f"  [+] Downloaded: {filename} ({width}x{height})")
                            count += 1
                            time.sleep(1.0) # Rate limiting
                
                if count < num_images:
                    print(f"  [!] Only found {count}/{num_images} images for '{keyword}' matching dimensions.")

            except Exception as e:
                print(f"  [!] Error searching for '{keyword}': {e}")
                continue

def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch high-quality images from DuckDuckGo based on keywords.")
    parser.add_argument("--csv", type=str, default="keywords.csv", help="Path to keywords file.")
    parser.add_argument("--width", type=int, default=DEFAULT_MIN_WIDTH, help="Minimum width.")
    parser.add_argument("--height", type=int, default=DEFAULT_MIN_HEIGHT, help="Minimum height.")
    parser.add_argument("--count", type=int, default=DEFAULT_IMAGE_COUNT, help="Images per keyword.")
    parser.add_argument("--output", type=str, default="input-images/celebs", help="Output directory.")
    parser.add_argument("--verbose", action="store_true", help="Print detailed progress.")
    args = parser.parse_args()

    # Base paths relative to script location
    script_dir = Path(__file__).parent
    csv_path = (script_dir / args.csv).resolve()
    output_path = (script_dir.parent / args.output).resolve()

    try:
        fetch_images(
            keywords_file=csv_path,
            min_width=args.width,
            min_height=args.height,
            num_images=args.count,
            output_dir=output_path,
            verbose=args.verbose
        )
    except Exception as e:
        print(f"Fatal error: {e}")
        exit(1)

if __name__ == "__main__":
    main()
