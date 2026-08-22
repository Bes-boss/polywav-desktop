"""Generate a realistic field-recording poly WAV for the user-journey audit.

8-channel 48kHz/24-bit WAV with a bext chunk. The bext Description carries a
comma-separated channel list (the format read_bext_channel_names understands):
  "EP1_001_Host,EP1_002_GuestA,..." (prefix, take/role, num pattern)

Also writes distinct tones per channel so demuxed mono files can be
identified by their dominant frequency.
"""
import struct
import math
import sys

OUT = sys.argv[1] if len(sys.argv) > 1 else "field_recording.wav"
SR = 48000
SECONDS = 5.0
NCH = 8
BITS = 24

NAMES = [
    "EP1_001_Presenter",
    "EP1_002_Guest_A",
    "EP1_003_Guest_B",
    "EP1_004_Crowd_L",
    "EP1_005_Crowd_R",
    "EP1_006_MixL",
    "EP1_007_MixR",
    "EP1_008_Spare",
]

# Distinct tone per channel (Hz) for later verification
TONES = [220, 247, 277, 294, 330, 349, 392, 440]

description = ",".join(NAMES)

n_frames = int(SR * SECONDS)
bytes_per_sample = BITS // 8
data_size = n_frames * NCH * bytes_per_sample

with open(OUT, "wb") as f:
    # --- bext chunk (602 bytes) ---
    desc_bytes = description.encode("utf-8")[:256].ljust(256, b"\x00")
    bext = desc_bytes
    bext += b"SoundDevices MixPre-6".ljust(32, b"\x00")     # originator
    bext += b"EP1_FIELD_20260822".ljust(32, b"\x00")        # originator ref
    bext += b"2026-08-22".ljust(10, b"\x00")                # date
    bext += b"09:41:00".ljust(8, b"\x00")                   # time
    bext += struct.pack("<I", 0)                             # time ref low
    bext += struct.pack("<I", 0)                             # time ref high
    bext += struct.pack("<H", 2)                             # version
    bext += b"\x00" * 64                                     # UMID
    bext += struct.pack("<h", -190)                          # loudness
    bext += struct.pack("<h", 80)                            # loudness range
    bext += struct.pack("<h", -800)                          # max true peak (x100)
    bext += struct.pack("<h", -1800)                         # max momentary
    bext += struct.pack("<h", -1500)                         # max shortterm
    bext += b"\x00" * (602 - 422)                            # reserved

    fmt_data = struct.pack("<H", 1)                          # PCM
    fmt_data += struct.pack("<H", NCH)
    fmt_data += struct.pack("<I", SR)
    fmt_data += struct.pack("<I", SR * NCH * bytes_per_sample)
    fmt_data += struct.pack("<H", NCH * bytes_per_sample)
    fmt_data += struct.pack("<H", BITS)

    riff_size = 36 + (8 + len(bext)) + (8 + len(fmt_data)) + (8 + data_size)

    f.write(b"RIFF")
    f.write(struct.pack("<I", riff_size))
    f.write(b"WAVE")
    f.write(b"fmt ")
    f.write(struct.pack("<I", len(fmt_data)))
    f.write(fmt_data)
    f.write(b"bext")
    f.write(struct.pack("<I", len(bext)))
    f.write(bext)
    f.write(b"data")
    f.write(struct.pack("<I", data_size))

    # Interleaved frames, 24-bit little-endian samples.
    # Ch n gets tone TONES[n] at moderate level; small per-channel offset.
    amp = 0.15
    chunk = bytearray()
    for i in range(n_frames):
        t = i / SR
        for ch in range(NCH):
            v = amp * math.sin(2 * math.pi * TONES[ch] * t)
            s = int(v * 8388607)
            chunk += struct.pack("<i", s)[0:3]
        if len(chunk) >= 65536:
            f.write(bytes(chunk[: len(chunk) - (len(chunk) % (NCH * 3))]))
            del chunk[: len(chunk) - (len(chunk) % (NCH * 3))]
    if chunk:
        f.write(bytes(chunk))

print("wrote", OUT)
