"""Reproducible local extraction from Jenny's supplied reference (no generated art).
Usage: /workspace/obs-image-env/bin/python scripts/extract-observatory-art.py /workspace/obs-target.jpg
The reference remains untouched; all typography is rendered by the app.
"""
import sys
from pathlib import Path
import cv2
import numpy as np
from PIL import Image
src = cv2.imread(sys.argv[1])
src = cv2.resize(src, (576, 1024), interpolation=cv2.INTER_AREA)
mask = np.zeros(src.shape[:2], np.uint8)
# Remove reference labels, not the holographic glass or cloud art.
for x,y,w,h in [(163,49,254,20),(229,567,121,28),(166,630,250,23),
                 (130,691,70,22),(350,691,111,22),
                 (70,770,190,22),(467,769,36,23),
                 (70,821,160,22),(467,820,36,23),
                 (70,872,190,22),(467,871,36,23),
                 (70,923,182,22),(467,922,36,23)]:
    patch = src[y:y+h,x:x+w]
    ink = (patch.min(axis=2) > 150) & ((patch.max(axis=2).astype(int)-patch.min(axis=2)) < 65)
    mask[y:y+h,x:x+w][ink] = 255
mask[49:70,163:419] = 255
mask[718:724,50:283] = 255
mask = cv2.dilate(mask, np.ones((7,7),np.uint8))
clean = cv2.inpaint(src, mask, 4, cv2.INPAINT_TELEA)
# Remove the baked-in 92, including its bloom, so totals are truly live.
num = np.zeros(src.shape[:2], np.uint8)
hsv = cv2.cvtColor(src, cv2.COLOR_BGR2HSV)
region = np.zeros_like(num); region[250:346,231:343] = 255
num[(hsv[:,:,0] >= 10) & (hsv[:,:,0] <= 43) & (hsv[:,:,1] > 45) & (hsv[:,:,2] > 145) & (region > 0)] = 255
num = cv2.dilate(num, np.ones((9,9),np.uint8))
clean = cv2.inpaint(clean, num, 7, cv2.INPAINT_TELEA)
out = Path('src/assets/observatory'); out.mkdir(parents=True,exist_ok=True)
Image.fromarray(cv2.cvtColor(clean,cv2.COLOR_BGR2RGB)).save(out/'cloud-reference-scene.webp',quality=96)
# A cloud-only strip for the outer desktop background (no duplicate crystals).
clouds = clean[975:1024,:]
Image.fromarray(cv2.cvtColor(clouds,cv2.COLOR_BGR2RGB)).resize((1152,512)).save(out/'cloud-reference-edge.webp',quality=90)

# Sample the reference's actual gold glitter palette for the live numeral texture.
palette = src[(hsv[:,:,0] >= 10) & (hsv[:,:,0] <= 43) & (hsv[:,:,1] > 45) & (hsv[:,:,2] > 180) & (region > 0)]
rng = np.random.default_rng(92)
grain = palette[rng.integers(0,len(palette),size=(64,64))]
Image.fromarray(cv2.cvtColor(grain,cv2.COLOR_BGR2RGB)).save(out/'gold-grain.webp',lossless=True)
