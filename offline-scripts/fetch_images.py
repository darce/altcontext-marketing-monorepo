import csv
import os
import requests
import argparse
import time
from duckduckgo_search import DDGS
from pathlib import Path

def download_image(url, folder, filename):
    try:
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            # Simple check for image extension or content type
            ext = url.split('.')[-1].split('?')[0]
            if len(ext) > 4 or not ext.isalnum():
                ext = 'jpg'
            
            filepath = os.path.join(folder, f"{filename}.{ext}")
            with open(filepath, 'wb') as f:
                f.write(response.content)
            return True
    except Exception as e:
        print(f"Failed to download {url}: {e}")
    return False

def fetch_images(keywords_file, min_width, min_height, num_images, output_dir):
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    
    with open(keywords_file, mode='r', encoding='utf-8') as f:
        # User's CSV has names one per line, potentially without header now
        lines = f.readlines()
        keywords = [line.strip().strip(',') for line in lines if line.strip()]

    with DDGS() as ddgs:
        for keyword in keywords:
            if not keyword or keyword.lower() == 'keyword':
                continue
                
            print(f"Searching for: {keyword}...")
            count = 0
            
            # Using ddgs.images to search
            # We can't strictly filter by exact dimensions in the search query easily with DDGS, 
            # but we can filter the results.
            results = ddgs.images(
                keyword,
                region="wt-wt",
                safesearch="moderate",
                size="large", # Helps with high quality
            )
            
            for r in results:
                if count >= num_images:
                    break
                
                url = r.get('image')
                width = r.get('width', 0)
                height = r.get('height', 0)
                
                if width >= min_width and height >= min_height:
                    filename = f"{keyword.replace(' ', '_').lower()}_{count + 1}"
                    if download_image(url, output_dir, filename):
                        print(f"  [+] Downloaded: {filename}")
                        count += 1
                        time.sleep(1) # Be polite
                
            if count < num_images:
                print(f"  [!] Only found {count} images for '{keyword}' matching dimensions.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fetch images based on keywords from a CSV.")
    parser.add_argument("--csv", default="keywords.csv", help="Path to keywords CSV file")
    parser.add_argument("--width", type=int, default=1000, help="Minimum width")
    parser.add_argument("--height", type=int, default=1000, help="Minimum height")
    parser.add_argument("--count", type=int, default=1, help="Number of images per keyword")
    parser.add_argument("--output", default="../input-images", help="Output directory")

    args = parser.parse_args()
    
    # Resolve paths relative to script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    csv_path = os.path.join(script_dir, args.csv)
    output_path = os.path.join(script_dir, args.output)
    
    fetch_images(csv_path, args.width, args.height, args.count, output_path)
