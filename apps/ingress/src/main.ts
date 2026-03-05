import 'dotenv/config'
import { CollectorPostData, collectorPostDataType } from '@spron/collectors'
import { createClient, Image, Video } from '@spron/database'
import { getLogger } from '@spron/utils'
import { Job, Worker } from 'bullmq'
import { Redis } from 'ioredis'

import { InputJsonObject } from '../../../packages/database/src/generated/internal/prismaNamespace.js'
import { createEnricherQueues, EnricherQueue } from './enrichers.js'
import { getEnvironment } from './environment.js'

const logger = getLogger()
const environment = getEnvironment()

const prisma = createClient(environment.DATABASE_URL)

await prisma.$connect()

const redisConection = new Redis(environment.BULLMQ_REDIS_URL)

const postEnricherQueues: EnricherQueue[] = createEnricherQueues(environment.POST_ENRICHER_QUEUE_NAMES,
  redisConection)
const imageEnricherQueues: EnricherQueue[] = createEnricherQueues(environment.IMAGE_ENRICHER_QUEUE_NAMES,
  redisConection)
const videoEnricherQueues: EnricherQueue[] = createEnricherQueues(environment.VIDEO_ENRICHER_QUEUE_NAMES,
  redisConection)

async function jobProcessor (job: Job<CollectorPostData>): Promise<void> {
  let collectorPostData: CollectorPostData
  try {
    collectorPostData = collectorPostDataType.parse(job.data)
  } catch (error) {
    logger.warn(`received invalid job data: ${error}`)
    return
  }
  logger.debug(`received collector data: ${JSON.stringify(collectorPostData)}`)

  await prisma.$transaction(async txn => {
    const source = await txn.source.upsert({
      create: {
        type: collectorPostData.source.type
      },
      update: {},
      where: {
        type: collectorPostData.source.type
      }
    })
    const author = await txn.author.upsert({
      create: {
        handle: collectorPostData.source.author.handle ?? null,
        idAtSource: collectorPostData.source.author.id,
        name: collectorPostData.source.author.name,
        sourceId: source.id
      },
      update: {
        handle: collectorPostData.source.author.handle ?? null,
        name: collectorPostData.source.author.name,
      },
      where: {
        idAtSource_sourceId: {
          idAtSource: collectorPostData.source.author.id,
          sourceId: source.id
        }
      }
    })

    const post = await txn.post.create({
      data: {
        authorId: author.id,
        collectedAt: new Date(collectorPostData.collectedAt),
        collectorId: collectorPostData.id,
        collectorMetadata: collectorPostData.metadata as InputJsonObject,
        createdAt: new Date(collectorPostData.createdAt),
        textContent: collectorPostData.content.text ?? null,
        url: collectorPostData.url
      }
    })
    const images: Image[] = await txn.image.createManyAndReturn({
      data: collectorPostData.content.images.map(image => ({
        collectorMetadata: image.metadata as InputJsonObject,
        postId: post.id,
        storageBucket: image.bucket,
        storageKey: image.key
      }))
    })
    const videos: Video[] = await txn.video.createManyAndReturn({
      data: collectorPostData.content.videos.map(video => ({
        collectorMetadata: video.metadata as InputJsonObject,
        postId: post.id,
        storageBucket: video.bucket,
        storageKey: video.key
      }))
    })

    await Promise.all(postEnricherQueues.map(async queue => {
      await queue.add(`post-${post.id}`, post.id)
    }))
    for (const image of images) {
      await Promise.all(imageEnricherQueues.map(async queue => {
        await queue.add(`image-${image.id}`, image.id)
      }))
    }
    for (const video of videos) {
      await Promise.all(videoEnricherQueues.map(async queue => {
        await queue.add(`video-${video.id}`, video.id)
      }))
    }
  })

  logger.info(`finished ingressing post '${collectorPostData.id}'`)
}

const worker = new Worker<CollectorPostData>(environment.BULLMQ_QUEUE_NAME, jobProcessor, {
  connection: redisConection
})

await worker.run()
logger.info('worker started')

await prisma.$disconnect()
