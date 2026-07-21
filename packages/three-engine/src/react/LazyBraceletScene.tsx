import { lazy, Suspense } from "react";

import type { BraceletCanvasProps } from "./BraceletCanvas";

const BraceletCanvas = lazy(() => import("./BraceletCanvas"));

export type LazyBraceletSceneProps = BraceletCanvasProps & {
  readonly fallback?: React.ReactNode;
};

export function LazyBraceletScene({ fallback = null, ...props }: LazyBraceletSceneProps) {
  return (
    <Suspense fallback={fallback}>
      <BraceletCanvas {...props} />
    </Suspense>
  );
}
