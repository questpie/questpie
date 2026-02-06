export type Headline = {
  top: string;
  highlight: string;
};

export const headlines: Headline[] = [
  {
    top: "Stop Building Admin Panels.",
    highlight: "Start Shipping Products.",
  },
];

export function getRandomHeadlineIndex(): number {
  return 0;
}
