import { DesignV1Schema } from "./design.schema";

// DesignV1 deliberately contains no costs or supplier data. This separately named
// schema documents the public trust boundary and keeps DTO declarations explicit.
export const PublicDesignV1Schema = DesignV1Schema;

export type PublicDesignV1 = typeof PublicDesignV1Schema._output;
