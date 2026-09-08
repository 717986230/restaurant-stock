import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'stock', component: () => import('@/views/StockView.vue') },
    { path: '/moves', name: 'moves', component: () => import('@/views/MovesView.vue') },
    { path: '/stocktake', name: 'stocktake', component: () => import('@/views/StocktakeView.vue') },
    { path: '/items/new', name: 'item-new', component: () => import('@/views/ItemEditView.vue') },
    { path: '/items/:id', name: 'item', component: () => import('@/views/ItemView.vue') },
    { path: '/items/:id/edit', name: 'item-edit', component: () => import('@/views/ItemEditView.vue') },
    { path: '/purchases', name: 'purchases', component: () => import('@/views/PurchasesView.vue') },
    { path: '/purchases/new', name: 'purchase-new', component: () => import('@/views/PurchaseEditView.vue') },
    { path: '/purchases/:id', name: 'purchase', component: () => import('@/views/PurchaseDetailView.vue') },
    { path: '/suppliers', name: 'suppliers', component: () => import('@/views/SuppliersView.vue') },
    { path: '/receiving', name: 'receiving', component: () => import('@/views/ReceivingListView.vue') },
    { path: '/receiving/:id', name: 'receiving-slip', component: () => import('@/views/ReceivingSlipView.vue') },
    { path: '/settlement', name: 'settlement', component: () => import('@/views/SettlementView.vue') },
    { path: '/summary', name: 'summary', component: () => import('@/views/SummaryView.vue') },
    { path: '/more', name: 'more', component: () => import('@/views/MoreView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
});
