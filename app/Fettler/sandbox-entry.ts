// The sandbox: a tinker session with no project behind it.
import process from 'node:process'
import { serveTinker } from '@stacksjs/tinker'

const { ok } = await serveTinker({ boot: false })
process.exit(ok ? 0 : 1)
