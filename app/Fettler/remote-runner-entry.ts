// What is bundled and sent to a target: the session engine, under a name the loader calls.
import { serveTinker } from '@stacksjs/tinker'

;(globalThis as { __fettlerServe?: typeof serveTinker }).__fettlerServe = serveTinker
