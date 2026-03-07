import { DeleteObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { PassThrough, Readable, Writable } from 'node:stream'

export interface S3StorageEntry {
  bucket: string
  key: string
}

interface S3StorageConfig {
  accessKey: string
  endpoint: string
  region: string
  secretKey: string
}

interface S3StorageEnvironment {
  S3_STORAGE_ACCESS_KEY: string
  S3_STORAGE_ENDPOINT: string
  S3_STORAGE_REGION: string
  S3_STORAGE_SECRET_KEY: string
}

interface UploadStreamWithDoneCallback {
  done: () => Promise<void>
  stream: Writable
}

export class S3Storage {
  private readonly client: S3Client

  constructor (config: S3StorageConfig) {
    this.client = new S3Client({
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey
      },
      endpoint: config.endpoint,
      forcePathStyle: true,
      region: config.region
    })
  }

  async delete (entry: S3StorageEntry): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: entry.bucket,
      Key: entry.key
    }))
  }

  async getDownloadStream (entry: S3StorageEntry): Promise<Readable> {
    const result = await this.client.send(new GetObjectCommand({
      Bucket: entry.bucket,
      Key: entry.key
    }))
    const body = result.Body
    if (!body) {
      throw new Error(`'${entry.bucket}/${entry.key}' S3 object not found`)
    }
    if (body instanceof Readable) {
      return body
    }
    throw new Error('S3 object body stream is not instanceof Readable')
  }

  getUploadStream (entry: S3StorageEntry): UploadStreamWithDoneCallback {
    const passThrough = new PassThrough()
    const upload = new Upload({
      client: this.client,
      leavePartsOnError: false,
      params: {
        Body: passThrough,
        Bucket: entry.bucket,
        Key: entry.key
      },
      partSize: 8 * 1024 * 1024,
      queueSize: 4
    })
    return {
      done: async () => { await upload.done() },
      stream: passThrough
    }
  }
}

export function createS3Storage (environment: S3StorageEnvironment): S3Storage {
  return new S3Storage({
    accessKey: environment.S3_STORAGE_ACCESS_KEY,
    endpoint: environment.S3_STORAGE_ENDPOINT,
    region: environment.S3_STORAGE_REGION,
    secretKey: environment.S3_STORAGE_SECRET_KEY
  })
}
