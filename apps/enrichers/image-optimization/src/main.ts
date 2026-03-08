import 'dotenv/config'
import { createClient } from '@spron/database'
import { createEnricher, EnricherJobName } from '@spron/enrichers'
import { createS3Storage } from '@spron/storage'
import { getLogger } from '@spron/utils'

import { getEnvironment } from './environment.js'
import { ImageOptimizer } from './optimizer.js'

const logger = getLogger()
const environment = getEnvironment()

const prisma = createClient(environment.DATABASE_URL)

const storage = createS3Storage(environment)
const imageOptimizer = new ImageOptimizer({
  outputBucket: environment.S3_STORAGE_OUTPUT_BUCKET
}, storage)

await prisma.$connect()

async function processor (imageId: string): Promise<boolean> {
  const image = await prisma.image.findFirst({
    where: {
      id: imageId
    }
  })

  if (!image) {
    logger.warn(`image '${imageId}' not found`)
    return false
  }

  if (image.optimized) {
    logger.warn(`image '${imageId}' is already optimized`)
    return true
  }

  const oldImage = {
    bucket: image.storageBucket,
    key: image.storageKey
  }

  const { bucket, key } = await imageOptimizer.optimize(oldImage)
  await prisma.image.update({
    data: {
      optimized: true,
      storageBucket: bucket,
      storageKey: key
    },
    where: {
      id: imageId
    }
  })

  try {
    await storage.delete(oldImage)
  } catch (error) {
    logger.warn(`failed to delete old image: ${error}`)
  }

  return true
}

const enricher = createEnricher(environment, {
  [EnricherJobName.ENRICH_IMAGE]: processor
})

await enricher.run()
logger.info('enricher started')

await prisma.$disconnect()
