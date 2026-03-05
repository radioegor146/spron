import 'dotenv/config'
import { CollectorPostData, collectorPostDataType } from '@spron/collectors'
import { createClient, Image, Video } from '@spron/database'
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

    await enrichersFlowProducer.addBulk([
      ...(environment.POST_ENRICHER_QUEUE_NAMES.map(queue => ({
        data: post.id,
        name: `post-${post.id}`,
        queueName: queue
      }))),
      ...(environment.IMAGE_ENRICHER_QUEUE_NAMES.flatMap(queue => images.map(image => ({
        data: image.id,
        name: `image-${image.id}`,
        queueName: queue
      })))),
      ...(environment.VIDEO_ENRICHER_QUEUE_NAMES.flatMap(queue => videos.map(video => ({
        data: video.id,
        name: `video-${video.id}`,
        queueName: queue
      })))),
    ])
  })

  logger.info(`finished ingressing post '${collectorPostData.id}'`)
}

const worker = new Worker<CollectorPostData>(environment.BULLMQ_QUEUE_NAME, jobProcessor, {
  connection: {
    url: environment.BULLMQ_INGRESS_REDIS_URL
  }
})

await worker.run()
logger.info('worker started')

await prisma.$disconnect()
