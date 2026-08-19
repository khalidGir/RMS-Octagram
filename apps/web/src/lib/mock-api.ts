import type { DashboardData, MenuData } from './types';

const dashboardFixture: DashboardData = {
  restaurantName: 'Buna House',
  activeBranchId: 'bole-main',
  branches: [
    { id: 'bole-main', name: 'Bole Main', location: 'Bole Atlas' },
    { id: 'downtown', name: 'Downtown', location: 'Mexico Square' },
  ],
  metrics: [
    { label: "Today's revenue", value: 'ETB 48,260', detail: '12.4% from yesterday', direction: 'up' },
    { label: 'Active orders', value: '24', detail: '8 currently in kitchen', direction: 'neutral' },
    { label: 'Avg. prep time', value: '18 min', detail: '2 min faster today', direction: 'up' },
    { label: 'Payment reviews', value: '5', detail: 'Oldest waiting 7 min', direction: 'attention' },
  ],
  recentOrders: [
    { id: '1', number: '#1048', customer: 'Table 08', type: 'Dine-in', amountMinor: 184000, itemCount: 5, status: 'IN_PROGRESS', time: '2 min ago' },
    { id: '2', number: '#1047', customer: 'Meron T.', type: 'Pickup', amountMinor: 92000, itemCount: 2, status: 'PENDING_VERIFICATION', time: '5 min ago' },
    { id: '3', number: '#1046', customer: 'Counter order', type: 'POS', amountMinor: 136500, itemCount: 4, status: 'READY', time: '8 min ago' },
    { id: '4', number: '#1045', customer: 'Table 03', type: 'Dine-in', amountMinor: 67500, itemCount: 2, status: 'CONFIRMED', time: '11 min ago' },
  ],
  popularItems: [
    { id: '1', name: 'Special Tibs', category: 'Main dishes', sold: 46, revenueMinor: 1840000, color: '#B4532A' },
    { id: '2', name: 'Shiro Wot', category: 'Main dishes', sold: 39, revenueMinor: 1131000, color: '#D39A3E' },
    { id: '3', name: 'Buna Ceremony', category: 'Drinks', sold: 34, revenueMinor: 510000, color: '#31584A' },
  ],
};

export interface DashboardApi { getDashboard(): Promise<DashboardData>; }
export interface MenuApi { getMenu(): Promise<MenuData>; }

export const mockDashboardApi: DashboardApi = {
  async getDashboard() {
    await new Promise((resolve) => setTimeout(resolve, 180));
    return dashboardFixture;
  },
};

const menuFixture: MenuData = {
  categories: [
    { id: 'all', name: 'All items' }, { id: 'popular', name: 'Popular' }, { id: 'mains', name: 'Main dishes' },
    { id: 'breakfast', name: 'Breakfast' }, { id: 'drinks', name: 'Drinks' }, { id: 'dessert', name: 'Dessert' },
  ],
  items: [
    { id: 'tibs', name: 'Special Tibs', description: 'Tender beef, rosemary, onion and peppers', categoryId: 'mains', priceMinor: 40000, available: true, badge: 'Popular', initials: 'ST', tone: '#B4532A' },
    { id: 'shiro', name: 'Shiro Wot', description: 'Slow-simmered chickpea stew with injera', categoryId: 'mains', priceMinor: 29000, available: true, badge: 'Vegetarian', initials: 'SW', tone: '#D39A3E' },
    { id: 'beyaynetu', name: 'Beyaynetu', description: 'A generous selection of fasting favourites', categoryId: 'mains', priceMinor: 35000, available: true, initials: 'BY', tone: '#31584A' },
    { id: 'firfir', name: 'Special Firfir', description: 'Injera tossed in rich berbere sauce', categoryId: 'breakfast', priceMinor: 26000, available: true, initials: 'SF', tone: '#8E4A38' },
    { id: 'chechebsa', name: 'Chechebsa', description: 'Spiced flatbread with honey and yoghurt', categoryId: 'breakfast', priceMinor: 24000, available: true, initials: 'CH', tone: '#B77B3B' },
    { id: 'buna', name: 'Buna Ceremony', description: 'Traditional Ethiopian coffee service', categoryId: 'drinks', priceMinor: 15000, available: true, badge: 'House favourite', initials: 'BC', tone: '#49362D' },
    { id: 'spris', name: 'Fresh Spris', description: 'Layered seasonal fruit juice', categoryId: 'drinks', priceMinor: 13000, available: true, initials: 'FS', tone: '#D16C3B' },
    { id: 'baklava', name: 'House Baklava', description: 'Honey, pistachio and crisp pastry', categoryId: 'dessert', priceMinor: 12000, available: false, initials: 'HB', tone: '#A67C45' },
  ],
};

export const mockMenuApi: MenuApi = {
  async getMenu() {
    await new Promise((resolve) => setTimeout(resolve, 120));
    return menuFixture;
  },
};

export function formatEtb(amountMinor: number): string {
  return new Intl.NumberFormat('en-ET', { style: 'currency', currency: 'ETB', maximumFractionDigits: 0 }).format(amountMinor / 100);
}
