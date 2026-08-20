import { communityModule } from "./community/index.js";
import { crystalModule } from "./crystal/index.js";
import { designModule } from "./design/index.js";
import { orderModule } from "./order/index.js";
import { userModule } from "./user/index.js";

export const backendModules = [userModule, designModule, crystalModule, communityModule, orderModule] as const;

export { tarotModule } from "./tarot/index.js";
