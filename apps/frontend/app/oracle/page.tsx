import { isOracleFeatureEnabled } from "../../src/lib/api/api-runtime";
import { OracleSetupClient } from "./oracle-setup-client";

export const dynamic = "force-dynamic";

export default function OracleSetupPage() {
  return <OracleSetupClient enabled={isOracleFeatureEnabled()} />;
}
