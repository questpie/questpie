import { authConfig } from "questpie/app";
export default authConfig({
    emailAndPassword: { enabled: true, requireEmailVerification: false },
});
