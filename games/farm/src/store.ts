import { createSave } from '@interverse/engine';

/** Local farm save (plots, weather clock, stats). Verium is the shared wallet. */
export const store = createSave('farm', 1);
