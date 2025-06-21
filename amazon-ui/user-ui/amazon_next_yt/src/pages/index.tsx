import Banner from "@/components/Banner";
import Products from "@/components/Products";
import { ProductProps } from "../../type";
import { useDispatch } from "react-redux";
import { useEffect } from "react";
import { setAllProducts } from "@/store/nextSlice";
import { productsData } from "../../data/product-data"; // Import the data

interface Props {
  productData: ProductProps;
}

export default function Home({ productData }: Props) {
  const dispatch = useDispatch();

  useEffect(() => {
    // Use imported data instead of props
    dispatch(setAllProducts({ allProducts: productsData }));
  }, [dispatch]);

  return (
    <main>
      <div className="max-w-screen-2xl mx-auto">
        <Banner />
        <div className="relative md:-mt-20 lgl:-mt-32 xl:-mt-60 z-20 mb-10">
          {/* Pass imported data to Products component */}
          <Products productData={productsData} />
        </div>
      </div>
    </main>
  );
}
