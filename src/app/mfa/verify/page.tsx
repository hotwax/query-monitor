import { Suspense } from "react";
import MfaVerifyForm from "@/components/MfaVerifyForm";

export default function MfaVerifyPage() {
  return (
    <div className="container" style={{ maxWidth: 380, paddingTop: 96 }}>
      <Suspense fallback={null}>
        <MfaVerifyForm />
      </Suspense>
    </div>
  );
}
