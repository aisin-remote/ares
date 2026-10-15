export type GlobalSearchResult = {
  type: 'Order Sheet' | 'Receipt' | 'Kanban' | 'Part' | 'Supplier';
  title: string;
  subtitle: string;
  href: string;
  icon: string;
};

export type NavNotification = {
  id: string;
  title: string;
  detail: string;
  href: string;
  tone: 'warn' | 'danger';
  count: number;
};
