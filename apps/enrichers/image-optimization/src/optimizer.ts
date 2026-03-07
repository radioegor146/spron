import { S3Storage, S3StorageEntry } from '@spron/storage'
import { getAsBuffer } from '@spron/utils'
import sharp from 'sharp'

interface ImageOptimizerConfig {
  outputBucket: string
}

export class ImageOptimizer {
  constructor (private readonly config: ImageOptimizerConfig, private readonly storage: S3Storage) {}

  async optimize (image: S3StorageEntry): Promise<S3StorageEntry> {
    const outputEntry = {
      bucket: this.config.outputBucket,
      key: image.key
    }

    const inputBuffer = await getAsBuffer(await this.storage.getDownloadStream(image))

    const buffer = sharp(inputBuffer)
      .jpeg()
      .toBuffer()

    const { done, stream } = this.storage.getUploadStream(outputEntry)

    const writePromise = new Promise<void>((resolve, reject) => {
      stream.write(buffer, error => {
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      })
    })

    await Promise.all([writePromise, done])

    return image
  }
}
