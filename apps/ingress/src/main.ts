import 'dotenv/config'
import { PrismaClient } from '@spron/database'

console.log('started')

const client = new PrismaClient({})
