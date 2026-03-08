import 'dotenv/config'
import { createClient } from '@spron/database'
import { createEnricher, EnricherJobName } from '@spron/enrichers'
import { PerceptionAPI } from '@spron/perception-api'
import { createS3Storage } from '@spron/storage'
import { getAsBuffer, getLogger } from '@spron/utils'

import { getEnvironment } from './environment.js'

const logger = getLogger()

const environment = getEnvironment()

const prisma = createClient(environment.DATABASE_URL)

const storage = createS3Storage(environment)

const perception = new PerceptionAPI(environment.PERCEPTION_API_BASE_URL)

await prisma.$connect()

interface DuplicateImage {
  id: string
  similarity: number
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

  if (image.duplicateReferenceId !== null) {
    logger.warn(`image '${imageId}' already has duplicate reference id`)
    return true
  }

  const imageBuffer = await getAsBuffer(await storage.getDownloadStream({
    bucket: image.storageBucket,
    key: image.storageKey
  }))

  const vector = await perception.getEmbeddings(imageBuffer)

  const duplicateImages = await prisma.$queryRaw<DuplicateImage[]>`select id, (1 - (deduplicationVector <=> ${
    JSON.stringify(vector)}::vector)) as 'similarity' from Image where 'similarity' >= ${
    environment.SIMILARITY_THRESHOLD} order by 'similarity' desc limit 1`
  const topDuplicateImage = duplicateImages[0]

  if (!topDuplicateImage) {
    return true
  }

  logger.info(`for image '${imageId}' found similar image '${topDuplicateImage.id}' with similarity ${topDuplicateImage.similarity}`)

  await prisma.$executeRaw`update Image set duplicateReferenceId = ${
    topDuplicateImage.id}, deduplicationVector = ${
      JSON.stringify(vector)}::vector, duplicateSimilarity = ${topDuplicateImage.similarity} where id = ${imageId}`

  return true
}

const enricher = createEnricher(environment, {
  [EnricherJobName.ENRICH_IMAGE]: processImage
})

await enricher.run()
logger.info('enricher started')

await prisma.$disconnect()
