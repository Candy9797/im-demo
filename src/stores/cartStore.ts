import { create } from 'zustand';
import type { Product } from '@/lib/shop/mockProducts';

export interface CartItem {
  product: Product;
  quantity: number;
}

interface CartStore {
  items: CartItem[];
  addItem: (product: Product, quantity?: number) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clear: () => void;
  totalCount: () => number;
  totalAmount: () => number;
}

export const useCartStore = create<CartStore>((set, get) => ({
  items: [],

  addItem: (product, quantity = 1) => {
    set((state) => {
      const idx = state.items.findIndex((i) => i.product.id === product.id);
      const next = [...state.items];
      if (idx >= 0) {
        next[idx] = { ...next[idx], quantity: next[idx].quantity + quantity };
      } else {
        next.push({ product, quantity });
      }
      return { items: next };
    });
  },

  removeItem: (productId) => {
    set((state) => ({
      items: state.items.filter((i) => i.product.id !== productId),
    }));
  },

  updateQuantity: (productId, quantity) => {
    if (quantity <= 0) {
      get().removeItem(productId);
      return;
    }
    set((state) => ({
      items: state.items.map((i) =>
        i.product.id === productId ? { ...i, quantity } : i
      ),
    }));
  },

  clear: () => set({ items: [] }),

  totalCount: () =>
    get().items.reduce((sum, i) => sum + i.quantity, 0),

  totalAmount: () =>
    get().items.reduce((sum, i) => sum + i.product.price * i.quantity, 0),
}));
