import 'dotenv/config'
import { createClient } from '@spron/database'
import { createEnricher, EnricherJobName } from '@spron/enrichers'
import { createS3Storage, S3StorageEntry } from '@spron/storage'
import { getAsBase64Data, getAsBuffer, getLogger } from '@spron/utils'
import ffmpegPath from 'ffmpeg-static'
import { path as ffprobePath } from 'ffprobe-static'
import childProcess from 'node:child_process'
import { createWriteStream } from 'node:fs'
import fsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import OpenAI from 'openai'
import { ChatCompletionContentPartImage } from 'openai/resources'

import { getEnvironment } from './environment.js'

const logger = getLogger()

const ffmpegBinary = ffmpegPath as unknown as string

if (!ffmpegBinary) {
  logger.fatal('no ffmpeg binary found')
  process.exit(1)
}

const ffprobeBinary = ffprobePath
if (!ffprobeBinary) {
  logger.fatal('no ffprobe binary found')
  process.exit(1)
}

const environment = getEnvironment()

const prisma = createClient(environment.DATABASE_URL)

const storage = createS3Storage(environment)

const openai = new OpenAI({
  apiKey: environment.OPENAI_API_KEY,
  baseURL: environment.OPENAI_BASE_URL
})

await prisma.$connect()

function getNumberOfFramesAndFrameRate (length: number): {
  frameRate: number,
  frames: number
} {
  if (length <= environment.VIDEO_DESCRIPTION_MIN_INTERVAL * environment.VIDEO_DESCRIPTION_MAX_FRAMES) {
    return {
      frameRate: 1 / environment.VIDEO_DESCRIPTION_MIN_INTERVAL,
      frames: Math.floor(length / environment.VIDEO_DESCRIPTION_MIN_INTERVAL)
    }
  }

  const interval = Math.floor(length / environment.VIDEO_DESCRIPTION_MAX_FRAMES)

  return {
    frameRate: 1 / interval,
    frames: environment.VIDEO_DESCRIPTION_MAX_FRAMES
  }
}

async function getVideoImageFramesAsBase64 (entry: S3StorageEntry): Promise<{
  fps: number
  images: string[],
}> {
  const temporaryPath = await fsPromises.mkdtemp(path.join(tmpdir(), 'description-video-'))
  try {
    const filePath = path.join(temporaryPath, 'video.mp4')
    const inputStream = await storage.getDownloadStream(entry)
    const fileStream = createWriteStream(filePath)
    await new Promise<void>((resolve, reject) => {
      inputStream.on('error', error => reject(error))
      fileStream.on('error', error => reject(error))
      inputStream.pipe(fileStream)
      inputStream.on('end', () => resolve())
    })

    const lengthString = await run(ffprobeBinary, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ])
    const length = Number.parseFloat(lengthString.trim())
    if (length < 0 || Number.isNaN(length) || !Number.isFinite(length)) {
      throw new Error(`invalid length: ${lengthString}`)
    }

    const framesDirectory = path.resolve(path.join(temporaryPath, 'frames'))

    await fsPromises.mkdir(path.join(temporaryPath, 'frames'))

    const { frameRate, frames } = getNumberOfFramesAndFrameRate(length)
    await run(ffmpegBinary, [
      '-i', filePath,
      '-vf', `fps=1/${frameRate.toFixed(2)}`,
      '-frames:v', frames.toFixed(0),
      '-q:v', '2',
      path.resolve(path.join(framesDirectory, 'frame-%06d.jpg')),
      '-y'
    ])

    const framesData: string[] = []
    const frameNames = await fsPromises.readdir(framesDirectory)
    frameNames.sort()
    for (const frameName of frameNames) {
      const framePath = path.join(framesDirectory, frameName)
      const stat = await fsPromises.lstat(framePath)
      if (!stat.isFile()) {
        continue
      }
      const frameData = await fsPromises.readFile(framePath)
      framesData.push(getAsBase64Data(frameData, 'image/jpeg'))
    }

    return {
      fps: frameRate,
      images: framesData
    }
  } finally {
    await fsPromises.rm(temporaryPath, {
      force: true,
      recursive: true
    })
  }
}

async function processImage (imageId: string): Promise<boolean> {
  const image = await prisma.image.findFirst({
    where: {
      id: imageId
    }
  })

  if (!image) {
    logger.warn(`image '${imageId}' not found`)
    return false
  }

  if (image.description !== null) {
    logger.warn(`image '${imageId}' already has description`)
    return false
  }

  const base64Image = getAsBase64Data(await getAsBuffer(await storage.getDownloadStream({
    bucket: image.storageBucket,
    key: image.storageKey
  })), 'image/jpeg')

  const completions = await openai.chat.completions.create({
    messages: [
      {
        content: [
          {
            text: environment.PROMPT_IMAGE_DESCRIPTION,
            type: 'text'
          },
          {
            image_url: {
              url: base64Image
            },
            type: 'image_url'
          }
        ],
        role: 'user'
      }
    ],
    model: environment.OPENAI_MODEL_NAME
  })

  const description = completions.choices[0]?.message.content
  if (!description) {
    throw new Error(`failed to get description for image '${imageId}'`)
  }

  await prisma.image.update({
    data: {
      description
    },
    where: {
      id: imageId
    }
  })

  return true
}

async function processor (type: EnricherJobName, id: string): Promise<boolean> {
  switch (type) {
    case EnricherJobName.ENRICH_IMAGE: {
      return await processImage(id)
    }
    case EnricherJobName.ENRICH_VIDEO: {
      return await processVideo(id)
    }
    default: {
      logger.warn(`received non image or video job: '${type}'`)
      return false
    }
  }
}

async function processVideo (videoId: string): Promise<boolean> {
  const video = await prisma.video.findFirst({
    where: {
      id: videoId
    }
  })

  if (!video) {
    logger.warn(`video '${videoId}' not found`)
    return false
  }
  if (video.description !== null) {
    logger.warn(`video '${videoId}' already has description`)
    return false
  }

  const { fps, images } = await getVideoImageFramesAsBase64({
    bucket: video.storageBucket,
    key: video.storageKey
  })

  const completions = await openai.chat.completions.create({
    messages: [
      {
        content: [
          {
            text: environment.PROMPT_VIDEO_DESCRIPTION,
            type: 'text'
          },
          {
            fps,
            type: 'video',
            video: images
          } as unknown as ChatCompletionContentPartImage // TODO video format is not standard for OpenAI API, so we use VL API from Qwen (Alibaba)
        ],
        role: 'user'
      }
    ],
    model: environment.OPENAI_MODEL_NAME
  })

  const description = completions.choices[0]?.message.content
  if (!description) {
    throw new Error(`failed to get description for video '${videoId}'`)
  }

  await prisma.video.update({
    data: {
      description
    },
    where: {
      id: videoId
    }
  })

  return true
}

async function run (binary: string, arguments_: string[]): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const process = childProcess.spawn(binary, arguments_, { stdio: 'pipe' })
    process.stdout?.on('data', data => {
      stdout.push(data)
    })
    process.stderr?.on('data', data => {
      stdout.push(data)
    })
    process.on('error', error => reject(error))
    process.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString('utf8'))
      } else {
        reject(new Error(`${binary} exited with code ${code}: ${Buffer.concat(stderr).toString('utf8')}`))
      }
    })
  })
}

const enricher = createEnricher(environment, processor)

await enricher.run()
logger.info('enricher started')

await prisma.$disconnect()
