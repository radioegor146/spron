from ctypes import cast
from ctypes import cdll
from ctypes import c_int
from ctypes import c_ubyte
from ctypes import POINTER
from ctypes import c_char_p
from PIL import Image
import io
import os
import logging
from fastapi import Body, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field
import uvicorn

HASH_SIZE = 144

PORT = int(os.getenv("PORT", 8000))

logger = logging.getLogger(__name__)

logger.info("loading dll")

lib_photo_dna = cdll.LoadLibrary(os.getenv("DLL_PATH", "photodna.dll"))

ComputeRobustHash = lib_photo_dna.ComputeRobustHash
ComputeRobustHash.argtypes = [c_char_p, c_int, c_int, c_int, POINTER(c_ubyte), c_int]
ComputeRobustHash.restype = c_int

logger.info("dll loaded successfully")


def get_hash(buffer) -> list[float]:
    image = Image.open(io.BytesIO(buffer))
    image = image.convert("RGB")

    hash_array = (c_ubyte * HASH_SIZE)()
    result = ComputeRobustHash(
        c_char_p(image.tobytes()), image.width, image.height, 0, hash_array, 0
    )
    if result == 0:
        hash_pointer = cast(hash_array, POINTER(c_ubyte))
        hash_data = [hash_pointer[i] / 255 for i in range(HASH_SIZE)]
    else:
        logger.warning(f"failed to process image: {result}")
        hash_data = [b / 255 for b in os.urandom(HASH_SIZE)]
    return hash_data


app = FastAPI()


class VectorResponse(BaseModel):
    vector: list[float] = Field(..., description="embedding vector")


@app.post("/", response_model=VectorResponse)
async def create_vector(
    payload: bytes = Body(..., media_type="image/jpeg"),
    content_type: str | None = Header(default=None),
) -> VectorResponse:
    if content_type != "image/jpeg":
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="content-Type must be image/jpeg",
        )
    if not payload:
        raise HTTPException(status_code=400, detail="empty body")
    return VectorResponse(vector=get_hash(payload))


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
