from PIL import Image
import io

def test_webp_xmp():
    # Create valid XMP packet
    xmp_data = b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about=""/></rdf:RDF></x:xmpmeta>'
    
    img = Image.new('RGB', (100, 100), color='red')
    
    # Try different ways to pass XMP
    # 1. 'xmp' in info
    img.info['xmp'] = xmp_data # common for PNG, maybe WebP?
    
    out = io.BytesIO()
    try:
        # Pillow doc says: "xmp: Optional XMP metadata" for WebP save
        img.save(out, 'WEBP', quality=80, xmp=xmp_data)
        print("Saved with xmp arg.")
    except Exception as e:
        print(f"Save failed: {e}")
        return

    data = out.getvalue()
    if b'<x:xmpmeta' in data:
        print("SUCCESS: XMP found in WebP data.")
    else:
        print("FAILURE: XMP NOT found in WebP data.")

test_webp_xmp()
