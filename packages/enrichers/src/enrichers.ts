import { backoffStrategy, BackoffStrategyEnvironment, getLogger } from '@spron/utils'
import { FlowProducer, Worker } from 'bullmq'
import z from 'zod'

export enum EnricherJobName {
  ENRICH_IMAGE = 'enrichImage',
  ENRICH_POST = 'enrichPost',
  ENRICH_VIDEO = 'enrichVideo'
}

export const idType = z.uuid()

interface Enricher {
  outputFlowProducer: FlowProducer
  run: () => Promise<void>
  worker: Worker,
}

interface EnricherEnvironment extends BackoffStrategyEnvironment {
  BULLMQ_INPUT_QUEUE_NAME: string
  BULLMQ_OUTPUT_QUEUE_NAMES: string[]
  BULLMQ_REDIS_URL: string
}

type EnricherProcessor = Partial<Record<EnricherJobName, (id: string) => Promise<boolean>>>

const logger = getLogger()

export function createEnricher (environment: EnricherEnvironment, processor: EnricherProcessor): Enricher {
  const outputFlowProducer = new FlowProducer({
    connection: {
      url: environment.BULLMQ_REDIS_URL
    }
  })
  const worker = new Worker(environment.BULLMQ_INPUT_QUEUE_NAME, async job => {
    let id: string
    let type: EnricherJobName
    try {
      id = z.uuid().parse(job.data)
      type = z.enum(EnricherJobName).parse(job.name)
    } catch {
      logger.warn(`received invalid enricher job: ${job.name} - ${JSON.stringify(job.data)}`)
      return
    }

    const currentTypeProcessor = processor[type]
    if (!currentTypeProcessor) {
      logger.warn(`unsupported enricher type: '${type}'`)
      return
    }

    const mustContinue = await currentTypeProcessor(id)
    if (mustContinue) {
      await outputFlowProducer.addBulk(environment.BULLMQ_OUTPUT_QUEUE_NAMES.map(queue => ({
        backoff: {
          type: 'custom'
        },
        data: id,
        name: type,
        queueName: queue
      })))
    }
  }, {
    autorun: false,
    connection: {
      url: environment.BULLMQ_REDIS_URL
    },
    settings: {
      backoffStrategy: backoffStrategy(environment)
    }
  })

  outputFlowProducer.on('error', error => {
    logger.error(`output flow producer failed with error: ${error}`)
  })
  worker.on('error', error => {
    logger.error(`worker failed with error: ${error}`)
  })

  return {
    outputFlowProducer,
    async run () {
      await worker.run()
    },
    worker
  }
}
