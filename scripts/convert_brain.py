"""
Convert FreeSurfer fsaverage5 left and right hemisphere .pial surfaces
into a single packed binary buffer for the browser.

The fsaverage5 surfaces ship with FreeSurfer and are mirrored in many
academic repositories. We download from CBIG (Yeo Lab, MIT-licensed
Schaefer2018 distribution) by default.

Output layout (little-endian):
    uint32   vertex_count   N
    uint32   triangle_count M
    float32  positions[3 * N]      (xyz, in unit-sphere coordinates)
    uint32   indices[3 * M]
    uint32   hemisphere_id[N]      (0 = left, 1 = right)

Usage:
    python scripts/convert_brain.py              writes ../public/brain.bin
    python scripts/convert_brain.py PATH         writes PATH
"""
import os, sys, struct, urllib.request
import numpy as np
import nibabel as nib

LH_URL = (
    "https://raw.githubusercontent.com/ThomasYeoLab/CBIG/master/"
    "stable_projects/brain_parcellation/Schaefer2018_LocalGlobal/"
    "Parcellations/FreeSurfer5.3/fsaverage5/surf/lh.pial"
)
RH_URL = LH_URL.replace("lh.pial", "rh.pial")

OUT_PATH = sys.argv[1] if len(sys.argv) > 1 else "public/brain.bin"
CACHE_DIR = "/tmp"


def fetch(url, name):
    dst = os.path.join(CACHE_DIR, name)
    if not os.path.exists(dst):
        print(f"fetching {name}")
        urllib.request.urlretrieve(url, dst)
    return dst


def load_pial(path):
    coords, faces = nib.freesurfer.read_geometry(path)
    return (
        np.ascontiguousarray(coords, dtype=np.float32),
        np.ascontiguousarray(faces, dtype=np.uint32),
    )


lh_path = fetch(LH_URL, "lh.pial")
rh_path = fetch(RH_URL, "rh.pial")

lh_pos, lh_tri = load_pial(lh_path)
rh_pos, rh_tri = load_pial(rh_path)

# FreeSurfer's lh.pial and rh.pial use opposite winding orders so that
# each hemisphere has outward-pointing normals in its own coordinate
# frame. After merging both into one mesh we need the windings to agree;
# we flip the rh triangles so the merged mesh has outward normals
# everywhere.
rh_tri = rh_tri[:, [0, 2, 1]]

# Shift RH triangle indices into the merged vertex array.
rh_tri_shifted = rh_tri + lh_pos.shape[0]
positions = np.concatenate([lh_pos, rh_pos], axis=0)
triangles = np.concatenate([lh_tri, rh_tri_shifted], axis=0)
hemi = np.concatenate(
    [
        np.zeros(lh_pos.shape[0], dtype=np.uint32),
        np.ones(rh_pos.shape[0], dtype=np.uint32),
    ]
)

centroid = positions.mean(axis=0)
positions -= centroid
scale = float(np.max(np.linalg.norm(positions, axis=1)))
positions /= scale
positions = positions.astype(np.float32)

n = positions.shape[0]
m = triangles.shape[0]

os.makedirs(os.path.dirname(OUT_PATH) or ".", exist_ok=True)
with open(OUT_PATH, "wb") as fh:
    fh.write(struct.pack("<II", n, m))
    fh.write(positions.tobytes(order="C"))
    fh.write(triangles.astype(np.uint32).tobytes(order="C"))
    fh.write(hemi.astype(np.uint32).tobytes(order="C"))

print(
    f"vertices={n} triangles={m} "
    f"bytes={8 + n * 12 + m * 12 + n * 4} out={OUT_PATH}"
)
