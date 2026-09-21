import {writeFile} from 'node:fs/promises';
import {documentSchema} from '../packages/zettel-ast/dist/v1/index.js';
await writeFile(new URL('../spec/v1.schema.json',import.meta.url),JSON.stringify({$schema:'http://json-schema.org/draft-07/schema#',...documentSchema},null,2)+'\n');
