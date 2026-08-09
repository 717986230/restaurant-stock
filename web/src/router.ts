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
    { path: '/more', name: 'more', component: () => import('@/views/MoreView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
});
