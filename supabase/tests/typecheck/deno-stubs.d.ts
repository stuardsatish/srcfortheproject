// Minimal ambient declarations so the website's TypeScript compiler can type-check the Edge Functions
// without a Deno install. Only what the functions use; everything else is checked for real.
declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): unknown;
  env: { get(key: string): string | undefined };
};

declare module "npm:razorpay@2.9.4" {
  class Razorpay {
    constructor(opts: any);
    [key: string]: any;
  }
  export default Razorpay;
}