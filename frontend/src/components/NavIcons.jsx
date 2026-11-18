// 24px outline icons (Lucide shapes, inlined to avoid a dependency). Decorative: the label next to each carries the meaning.
function Icon({ children }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const PlanIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </Icon>
);

export const MealsIcon = () => (
  <Icon>
    <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
  </Icon>
);

export const ShopIcon = () => (
  <Icon>
    <path d="m3 17 2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8" />
  </Icon>
);

export const KitchenIcon = () => (
  <Icon>
    <rect x="5" y="2" width="14" height="20" rx="2" />
    <path d="M5 10h14M9 6v1M9 14v3" />
  </Icon>
);
