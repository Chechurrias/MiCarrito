import catalog from '../../shared/products.json';

export type Product = {
  id: string;
  name: string;
  price: number;
  imageUrl: string;
  stock: number | null;
};

export const PRODUCTS: Product[] = catalog;
