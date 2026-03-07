import { S3Storage, S3StorageEntry } from '@spron/storage'
import { pipeline } from 'node:stream/promises'
import { FFmpeg } from 'prism-media'

interface VideoOptimizerConfig {
  outputBucket: string
}

export class VideoOptimizer {
  constructor (private readonly config: VideoOptimizerConfig, private readonly storage: S3Storage) {}

  async optimize (video: S3StorageEntry): Promise<S3StorageEntry> {
    const outputEntry = {
      bucket: this.config.outputBucket,
      key: video.key
    }

    const ffmpeg = new FFmpeg({
      args: [
        '-hide_banner', '-loglevel', 'error',
        '-i', 'pipe:0',
        '-map', '0:v:0',
        '-map', '0:a:0?',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '22',
        '-pix_fmt', 'yuv420p',
        '-profile:v', 'high',
        '-level', '4.1',
        '-c:a', 'aac',
        '-q:a', '2',
        '-ac', '2',
        '-ar', '48000',
        '-movflags', 'frag_keyframe+empty_moov',
        '-f', 'mp4',
        'pipe:1',
      ]
    })

    const { done, stream } = this.storage.getUploadStream(outputEntry)

    await Promise.all([pipeline(
      await this.storage.getDownloadStream(video),
      ffmpeg,
      stream
    ), done])

    return outputEntry
  }
}
