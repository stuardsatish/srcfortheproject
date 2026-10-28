import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";

import { addCart, removeCart } from "../../context/CartSlice";
import { addWishlist, removeWishlist } from "../../context/WishlistSlice";

import { supabase } from "../../context/SupabaseConfig";
import { upsertCartItem, decrementOrRemoveCartItem, nextAddQuantity, nextRemoveQuantity } from "../../utils/supabaseCart";
import { addWishlistItem, removeWishlistItem } from "../../utils/supabaseWishlist";
import { formatCurrency } from "../../utils/pricing";
import { listPriceSummary, listStockSummary, needsOptionChoice } from "./purchaseOptions";

import { FaHeart, FaRegHeart } from "react-icons/fa";

export const ProductCard = ({ product, variant = "desktop" }) => {
    const navigate = useNavigate();
    const dispatch = useDispatch();

    const cartItems = useSelector((state) => state.cart.cartItems);
    const wishlistItems = useSelector((state) => state.wishlist.wishlistItems);
    const user = useSelector((state) => state.user.user);

    const [avgRating, setAvgRating] = useState(0);
    const [reviewCount, setReviewCount] = useState(0);

    const productId = String(product.id);

    // Phase 1/4: availability and price describe the WHOLE product (every purchasable option), not only the main counter.
    // See purchaseOptions.js: listStockSummary / listPriceSummary / needsOptionChoice.
    const stockInfo = listStockSummary(product);
    const summary = listPriceSummary(product);
    const choose = needsOptionChoice(product); // the card cannot "add the product": the shopper must pick an option first
    const showCount = !stockInfo.out && stockInfo.units != null && !stockInfo.multi; // a number only when ONE tracked option exists
    const stock = stockInfo.out ? 0 : (stockInfo.units ?? 999999);

    const isOutOfStock = stockInfo.out;

    const isWishlisted = wishlistItems.some(
        (item) => String(item.id) === productId,
    );

    const existingItem = cartItems.find(
        (item) => String(item.id) === productId,
    ); /* =========================
       FETCH PRODUCT RATINGS
    ========================= */

    useEffect(() => {
        const fetchRatings = async () => {
            try {
                const { data: rows } = await supabase.from("reviews").select("rating").eq("product_id", productId);

                if (!rows || rows.length === 0) {
                    setAvgRating(0);
                    setReviewCount(0);
                    return;
                }

                let total = 0;
                let count = 0;

                rows.forEach((data) => {
                    if (data.rating) {
                        total += Number(data.rating);
                        count++;
                    }
                });

                const avg = total / count;

                setAvgRating(avg);
                setReviewCount(count);
            } catch (error) {
                console.log("Rating fetch error:", error);
            }
        };

        fetchRatings();
    }, [productId]); /* =========================
       WISHLIST TOGGLE
    ========================= */

    const handleWishlist = async (e) => {
        e.stopPropagation();

        if (!user) {
            alert("Please login first");
            return;
        }

        try {
            if (isWishlisted) {
                dispatch(removeWishlist(productId));
                await removeWishlistItem(user.uid, productId);
            } else {
                const reduxWishlistItem = {
                    userId: user.uid,
                    productId: productId,
                    id: productId,
                    title: product.title,
                    price: product.price,
                    image: product.thumbnail || product.image,
                    category: product.category,
                    addedAt: new Date().toISOString(),
                };

                dispatch(addWishlist(reduxWishlistItem));
                await addWishlistItem(user.uid, product);
            }
        } catch (error) {
            console.log("Wishlist error:", error);
        }
    };

    const handleIncrement = (e) => {
        e.stopPropagation();
        if (!user) {
            navigate("/login");
            return;
        }
        const qty = nextAddQuantity(cartItems, productId);
        dispatch(addCart(product));
        upsertCartItem(user.uid, product, qty);
    };

    const handleDecrement = (e) => {
        e.stopPropagation();
        const qty = nextRemoveQuantity(cartItems, productId);
        dispatch(removeCart(productId));
        decrementOrRemoveCartItem(user?.uid, productId, qty);
    }; /* =========================
       MOBILE VARIANT (≤640px)
       Shares all hooks/handlers above; only the layout differs.
    ========================= */

    if (variant === "mobile") {
        const priceLabel = `${summary.prefix ? summary.prefix + " " : ""}${formatCurrency(summary.price)}`; // was a hardcoded `$`

        // Stock badge derived from the existing numeric `stock` field

        let stockText, stockColor, stockItalic;
        if (isOutOfStock) {
            stockText = "Out of Stock";
            stockColor = "var(--color-primary)";
            stockItalic = true;
        } else if (showCount && stock <= 5) {
            stockText = `${stock} left`;
            stockColor = "var(--color-primary)";
            stockItalic = false;
        } else {
            stockText = "In Stock";
            stockColor = "var(--color-primary)";
            stockItalic = true;
        }

        const goToProduct = () =>
            navigate(`/product/${productId}`, { state: { product } });

        return (
            <div
                className="w-full bg-surface relative flex flex-col overflow-hidden"
                style={{
                    minHeight: "347px",
                    borderRadius: "12px",
                    boxShadow: "0px 4px 20px rgba(26,43,60,0.05)",
                    fontFamily: "Inter, sans-serif",
                }}
            >
                {/* WISHLIST BUTTON */}               {" "}
                <button
                    onClick={handleWishlist}
                    aria-label="Toggle wishlist"
                    className="absolute z-20 flex items-center justify-center"
                    style={{
                        top: "12px",
                        right: "12px",
                        width: "32px",
                        height: "32px",
                        background:
                            "color-mix(in srgb, var(--color-surface) 90%, transparent)",
                        borderRadius: "9999px",
                        backdropFilter: "blur(4px)",
                        WebkitBackdropFilter: "blur(4px)",
                    }}
                >
                    {" "}
                    {isWishlisted ? (
                        <FaHeart size={16} style={{ color: "var(--color-primary)" }} />
                    ) : (
                        <FaRegHeart size={16} style={{ color: "var(--color-muted)" }} />
                    )}
                    {" "}
                </button>
                {/* IMAGE AREA — square, full card width */}
                {" "}
                <div
                    onClick={goToProduct}
                    className="w-full cursor-pointer"
                    style={{ background: "var(--color-surface-muted)", padding: "8px" }}
                >
                    {" "}
                    <div className="w-full aspect-square">
                        {" "}
                        <img
                            src={product.thumbnail || product.image}
                            alt={product.title}
                            loading="lazy"
                            className="w-full h-full"
                            style={{ objectFit: "cover", borderRadius: "8px" }}
                        />
                        {" "}
                    </div>
                    {" "}
                </div>
                {/* CONTENT AREA */}               {" "}
                <div className="flex flex-col flex-1" style={{ padding: "12px" }}>
                    {/* Top cluster */}                   {" "}
                    <div onClick={goToProduct} className="cursor-pointer">
                        {" "}
                        <p
                            style={{
                                color: "var(--color-muted)",
                                fontWeight: 600,
                                fontSize: "12px",
                                textTransform: "uppercase",
                                letterSpacing: "0.6px",
                            }}
                        >
                            {product.category}
                            {" "}
                        </p>
                        {" "}
                        <h3
                            style={{
                                color: "var(--color-ink)",
                                fontWeight: 700,
                                fontSize: "14px",
                                lineHeight: "18px",
                                marginTop: "4px",
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                            }}
                        >
                            {product.title}
                            {" "}
                        </h3>
                        {/* Rating row */}                       {" "}
                        <div
                            className="flex items-center"
                            style={{ marginTop: "6px", gap: "4px" }}
                        >
                            {" "}
                            <span
                                style={{
                                    color: "var(--color-chart-gold)",
                                    fontSize: "11px",
                                    lineHeight: 1,
                                }}
                            >
                                ★
                            </span>
                            {" "}
                            <span
                                style={{
                                    color: "var(--color-muted)",
                                    fontWeight: 400,
                                    fontSize: "11px",
                                }}
                            >
                                {" "}
                                {reviewCount > 0
                                    ? `${avgRating.toFixed(1)} (${reviewCount})`
                                    : "No reviews"}
                                {" "}
                            </span>
                            {" "}
                        </div>
                        {" "}
                    </div>
                    {" "}
                    {/* Bottom cluster — pinned to bottom when slack exists */}
                    {" "}
                    <div style={{ marginTop: "auto" }}>
                        {/* Price + stock badge */}
                        {" "}
                        <div
                            className="flex items-center justify-between"
                            style={{ marginTop: "10px", marginBottom: "8px" }}
                        >
                            {" "}
                            <span
                                style={{
                                    color: "var(--color-ink)",
                                    fontWeight: 600,
                                    fontSize: "18px",
                                }}
                            >
                                {priceLabel}
                                {" "}
                            </span>
                            {" "}
                            <span
                                style={{
                                    color: stockColor,
                                    fontWeight: 500,
                                    fontSize: "10px",
                                    fontStyle: stockItalic ? "italic" : "normal",
                                    whiteSpace: "nowrap",
                                }}
                            >
                                {stockText}
                                {" "}
                            </span>
                            {" "}
                        </div>
                        {summary.note && (
                            <p style={{ color: "var(--color-muted)", fontSize: "11px", marginBottom: "8px" }}>
                                {summary.note}
                            </p>
                        )}
                        {/* CTA — keeps existing cart handlers */}
                        {" "}
                        {isOutOfStock ? (
                            <button
                                disabled
                                className="w-full flex items-center justify-center"
                                style={{
                                    height: "36px",
                                    borderRadius: "9999px",
                                    background: "var(--color-surface-muted)",
                                    color: "var(--color-muted)",
                                    fontWeight: 700,
                                    fontSize: "12px",
                                    letterSpacing: "0.6px",
                                    textTransform: "uppercase",
                                    cursor: "not-allowed",
                                }}
                            >
                                Out of Stock
                                {" "}
                            </button>
                        ) : choose ? (
                            <button
                                onClick={goToProduct}
                                className="w-full flex items-center justify-center"
                                style={{
                                    height: "36px",
                                    borderRadius: "9999px",
                                    background: "var(--color-primary)",
                                    color: "var(--color-inverse)",
                                    fontWeight: 700,
                                    fontSize: "12px",
                                    letterSpacing: "0.6px",
                                    textTransform: "uppercase",
                                }}
                            >
                                Choose options
                            </button>
                        ) : existingItem ? (
                            <div
                                className="w-full flex items-center justify-between"
                                style={{
                                    height: "36px",
                                    borderRadius: "9999px",
                                    border: "1px solid var(--color-primary)",
                                    overflow: "hidden",
                                }}
                            >
                                {" "}
                                <button
                                    onClick={handleDecrement}
                                    className="h-full flex-1 flex items-center justify-center"
                                    style={{
                                        color: "var(--color-primary)",
                                        fontWeight: 700,
                                        fontSize: "16px",
                                    }}
                                >
                                    −
                                    {" "}
                                </button>
                                {" "}
                                <span
                                    style={{
                                        color: "var(--color-ink)",
                                        fontWeight: 700,
                                        fontSize: "13px",
                                        minWidth: "20px",
                                        textAlign: "center",
                                    }}
                                >
                                    {existingItem.quantity}
                                    {" "}
                                </span>
                                {" "}
                                <button
                                    disabled={existingItem.quantity >= stock}
                                    onClick={handleIncrement}
                                    className="h-full flex-1 flex items-center justify-center"
                                    style={{
                                        color:
                                            existingItem.quantity >= stock
                                                ? "var(--color-disabled-fg)"
                                                : "var(--color-primary)",
                                        fontWeight: 700,
                                        fontSize: "16px",
                                    }}
                                >
                                    +
                                    {" "}
                                </button>
                                {" "}
                            </div>
                        ) : (
                            <button
                                onClick={handleIncrement}
                                className="w-full flex items-center justify-center"
                                style={{
                                    height: "36px",
                                    borderRadius: "9999px",
                                    background: "var(--color-primary)",
                                    color: "var(--color-inverse)",
                                    fontWeight: 700,
                                    fontSize: "12px",
                                    letterSpacing: "0.6px",
                                    textTransform: "uppercase",
                                }}
                            >
                                Add to Cart
                                {" "}
                            </button>
                        )}
                        {" "}
                    </div>
                    {" "}
                </div>
                {" "}
            </div>
        );
    }

    return (
        <div className="w-full h-full group">
            {" "}
            <div className="h-[340px] w-full bg-surface relative flex flex-col rounded-2xl overflow-hidden shadow-md group-hover:shadow-2xl transition duration-300 border border-border-subtle">
                {/* WISHLIST BUTTON (Independent absolute layer) */}
                {" "}
                <button
                    onClick={handleWishlist}
                    className="absolute top-4 right-4 z-50 bg-surface border border-border-subtle shadow-md p-2 rounded-full hover:bg-surface-muted transition-colors pointer-events-auto cursor-pointer"
                >
                    {" "}
                    {isWishlisted ? (
                        <FaHeart size={20} className="text-error" />
                    ) : (
                        <FaRegHeart size={20} className="text-muted hover:text-error" />
                    )}
                    {" "}
                </button>
                {/* Clickable Navigation Wrapper */}               {" "}
                <div
                    onClick={() =>
                        navigate(`/product/${productId}`, { state: { product } })
                    }
                    className="flex flex-col flex-1 cursor-pointer"
                >
                    {/* Background Image Container */}
                    {" "}
                    <div className="h-40 w-full p-4 flex items-center justify-center bg-surface-muted">
                        {" "}
                        <img
                            src={product.thumbnail || product.image}
                            alt={product.title}
                            loading="lazy"
                            className="h-full w-full object-contain mix-blend-multiply group-hover:scale-110 transition-transform duration-500"
                        />
                        {" "}
                    </div>
                    {/* Text Content */}                   {" "}
                    <div className="p-3 flex flex-col flex-1 bg-surface relative">
                        {" "}
                        <div className="absolute right-3 -top-5 bg-surface-inverse px-3 py-1.5 rounded-full shadow-lg">
                            {" "}
                            <span className="font-bold text-inverse tracking-wide text-xs">
                                {summary.prefix ? `${summary.prefix} ` : ""}₹{summary.price}
                            </span>
                            {" "}
                        </div>
                        {" "}
                        <p className="text-xs text-muted font-medium mb-1 uppercase tracking-wider">
                            {product.category}
                            {" "}
                        </p>
                        {" "}
                        <h3 className="font-bold text-ink text-[17px] mb-1.5 line-clamp-2 leading-tight">
                            {product.title}
                            {" "}
                        </h3>
                        {summary.note && (
                            <p className="text-[11px] text-muted mb-1">{summary.note}</p>
                        )}
                        {/* RATING & STOCK */}
                        {" "}
                        <div className="flex items-center justify-between mt-auto">
                            {" "}
                            <div className="flex items-center text-warning text-sm">
                                {" "}
                                {reviewCount > 0 ? (
                                    <>
                                        {" "}
                                        {"★".repeat(Math.round(avgRating))}
                                        {"☆".repeat(5 - Math.round(avgRating))}
                                        {" "}
                                        <span className="text-muted ml-2 text-[11px] font-black uppercase transition-colors">
                                            {" "}
                                            {avgRating.toFixed(1)}
                                            {" "}
                                        </span>
                                        {" "}
                                    </>
                                ) : (
                                    <span className="text-muted text-[11px] font-black uppercase tracking-wider">
                                        no review yet
                                        {" "}
                                    </span>
                                )}
                                {" "}
                            </div>
                            {" "}
                            <div
                                className={`font-black uppercase tracking-tighter px-2 py-0.5 rounded-md text-[10px] ${isOutOfStock
                                        ? "bg-error-subtle text-error"
                                        : showCount && stock <= 5
                                            ? "bg-error-subtle text-error"
                                            : "bg-surface-muted text-muted"
                                    }`}
                            >
                                {" "}
                                {isOutOfStock ? "out of stock" : showCount ? `${stock} QTY Available` : "in stock"}
                                {" "}
                            </div>
                            {" "}
                        </div>
                        {" "}
                    </div>
                    {" "}
                </div>
                {" "}
                {/* CART CONTROLS (Independent relative layer at bottom) */}
                {" "}
                <div className="px-3 pb-3 bg-surface z-40">
                    {" "}
                    {isOutOfStock ? (
                        <button
                            disabled
                            className="w-full bg-surface-muted text-muted border border-border rounded-xl py-3 cursor-not-allowed font-medium text-sm transition-all shadow-sm min-h-[44px]"
                        >
                            Out of Stock
                            {" "}
                        </button>
                    ) : choose ? (
                        <button
                            onClick={() => navigate(`/product/${productId}`, { state: { product } })}
                            className="w-full rounded-xl py-3 text-inverse font-semibold text-sm transition-all shadow-md hover:shadow-lg cursor-pointer min-h-[44px] bg-surface-inverse hover:bg-surface-inverse hover:-translate-y-0.5"
                        >
                            Choose options
                        </button>
                    ) : existingItem ? (
                        <div className="flex items-center justify-between bg-surface border-2 border-ink rounded-xl overflow-hidden shadow-sm">
                            {" "}
                            <button
                                onClick={handleDecrement}
                                className="bg-transparent text-ink hover:bg-surface-muted px-4 py-2.5 transition-colors flex-1 font-bold text-lg cursor-pointer min-h-[44px]"
                            >
                                -
                                {" "}
                            </button>
                            {" "}
                            <span className="font-bold text-ink px-2">
                                {existingItem.quantity}
                                {" "}
                            </span>
                            {" "}
                            <button
                                disabled={existingItem.quantity >= stock}
                                onClick={handleIncrement}
                                className={`px-4 py-2.5 text-ink hover:bg-surface-muted font-bold transition-colors flex-1 text-lg cursor-pointer min-h-[44px] ${existingItem.quantity >= stock
                                        ? "text-muted cursor-not-allowed"
                                        : "text-ink"
                                    }`}
                            >
                                +
                                {" "}
                            </button>
                            {" "}
                        </div>
                    ) : (
                        <button
                            disabled={isOutOfStock}
                            onClick={handleIncrement}
                            className={`w-full rounded-xl py-3 text-inverse font-semibold text-sm transition-all shadow-md hover:shadow-lg cursor-pointer min-h-[44px] ${isOutOfStock
                                    ? "bg-muted cursor-not-allowed"
                                    : "bg-surface-inverse hover:bg-surface-inverse hover:-translate-y-0.5"
                                }`}
                        >
                            Add to Cart
                            {" "}
                        </button>
                    )}
                    {" "}
                </div>
                {" "}
            </div>
            {" "}
        </div>
    );
};