import 'dotenv/config'
import { createClient } from '@spron/database'
import { createEnricher, EnricherJobName } from '@spron/enrichers'
import { createS3Storage } from '@spron/storage'
import { getLogger } from '@spron/utils'

import { getEnvironment } from './environment.js'
import { VideoOptimizer } from './optimizer.js'

const logger = getLogger()
const environment = getEnvironment()

const prisma = createClient(environment.DATABASE_URL)

const storage = createS3Storage(environment)

const videoOptimizer = new VideoOptimizer({
  outputBucket: environment.S3_STORAGE_OUTPUT_BUCKET
}, storage)

await prisma.$connect()

async function processor (type: EnricherJobName, videoId: string): Promise<boolean> {
  if (type !== EnricherJobName.ENRICH_VIDEO) {
    logger.warn(`received non video job: '${type}'`)
    return false
  }

  const video = await prisma.video.findFirst({
    where: {
      id: videoId
    }
  })

  if (!video) {
    logger.warn(`video '${videoId}' not found`)
    return false
  }

  if (video.optimized) {
    logger.warn(`video '${videoId}' is already optimized`)
    return true
  }

  const oldVideo = {
    bucket: video.storageBucket,
    key: video.storageKey
  }

  const { bucket, key } = await videoOptimizer.optimize(oldVideo)
  await prisma.video.update({
    data: {
      optimized: true,
      storageBucket: bucket,
      storageKey: key
    },
    where: {
      id: videoId
    }
  })

  try {
    await storage.delete(oldVideo)
  } catch (error) {
    logger.warn(`failed to delete old image: ${error}`)
  }

  return true
}

const enricher = createEnricher(environment, processor)

await enricher.run()
logger.info('enricher started')

await prisma.$disconnect()
