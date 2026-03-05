import 'dotenv/config'
import { CollectorPostData, collectorPostDataType } from '@spron/collectors'
import { createClient } from '@spron/database'
import { EnricherJobName } from '@spron/enrichers'
import { getLogger } from '@spron/utils'
import { FlowProducer, Job, Worker } from 'bullmq'

import { InputJsonObject } from '../../../packages/database/src/generated/internal/prismaNamespace.js'
import { getEnvironment } from './environment.js'

const logger = getLogger()
const environment = getEnvironment()

const prisma = createClient(environment.DATABASE_URL)

await prisma.$connect()

const enrichersFlowProducer = new FlowProducer({
  connection: {
    url: environment.BULLMQ_ENRICHERS_REDIS_URL
  }
})

async function jobProcessor (job: Job<CollectorPostData>): Promise<void> {
  let collectorPostData: CollectorPostData
  try {
    collectorPostData = collectorPostDataType.parse(job.data)
  } catch (error) {
    logger.warn(`received invalid job data: ${error}`)
    return
  }
  logger.debug(`received collector data: ${JSON.stringify(collectorPostData)}`)

  const { images, post, videos } = await prisma.$transaction(async txn => {
    const existingPost = await txn.post.findFirst({
      include: {
        images: true,
        videos: true
      },
      where: {
        collectorId: collectorPostData.id
      }
    })
    if (existingPost) {
      logger.warn(`received already existing post '${existingPost.collectorId}', retrying in queue`)
      return {
        images: existingPost.images,
        post: existingPost,
        videos: existingPost.videos
      }
    }
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
    const images = await txn.image.createManyAndReturn({
      data: collectorPostData.content.images.map(image => ({
        collectorMetadata: image.metadata as InputJsonObject,
        postId: post.id,
        storageBucket: image.bucket,
        storageKey: image.key
      }))
    })
    const videos = await txn.video.createManyAndReturn({
      data: collectorPostData.content.videos.map(video => ({
        collectorMetadata: video.metadata as InputJsonObject,
        postId: post.id,
        storageBucket: video.bucket,
        storageKey: video.key
      }))
    })

    return {
      images,
      post,
      videos
    }
  })

  await enrichersFlowProducer.addBulk([
    ...(environment.POST_ENRICHER_QUEUE_NAMES.map(queue => ({
      backoff: {
        type: 'custom'
      },
      data: post.id,
      name: EnricherJobName.ENRICH_POST,
      queueName: queue
    }))),
    ...(environment.IMAGE_ENRICHER_QUEUE_NAMES.flatMap(queue => images.map(image => ({
      backoff: {
        type: 'custom'
      },
      data: image.id,
      name: EnricherJobName.ENRICH_IMAGE,
      queueName: queue
    })))),
    ...(environment.VIDEO_ENRICHER_QUEUE_NAMES.flatMap(queue => videos.map(video => ({
      backoff: {
        type: 'custom'
      },
      data: video.id,
      name: EnricherJobName.ENRICH_VIDEO,
      queueName: queue
    })))),
  ])

  logger.info(`finished ingressing post '${collectorPostData.id}'`)
}

const worker = new Worker<CollectorPostData>(environment.BULLMQ_QUEUE_NAME, jobProcessor, {
  autorun: false,
  concurrency: environment.WORKER_CONCURRENCY,
  connection: {
    url: environment.BULLMQ_INGRESS_REDIS_URL
  },
  settings: {
    backoffStrategy: attemptsMade => {
      if (attemptsMade >= environment.WORKER_MAX_ATTEMPTS) {
        return -1
      }
      return environment.WORKER_BACKOFF_DELAY
    }
  }
})

enrichersFlowProducer.on('error', error => {
  logger.error(`enricher flow producer failed with error: ${error}`)
})
worker.on('error', error => {
  logger.error(`worker failed with error: ${error}`)
})

await worker.run()
logger.info('worker started')

await prisma.$disconnect()
