import { PublicDesignV1Schema } from "@mystcrag/design-contract";
import { standardAiDesignFixture } from "@mystcrag/design-contract/fixtures";

export const mockPublicDesign = PublicDesignV1Schema.parse(standardAiDesignFixture);
