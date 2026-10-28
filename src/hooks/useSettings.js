import { useState, useEffect } from "react";
import {
    getPaymentSettings,
    savePaymentSettings,
    getInvoiceSettings,
    saveInvoiceSettings,
    getShippingSettings,
    saveShippingSettings,
    getGstSettings,
    saveGstSettings,
} from "../services/settingsService";
import { toast } from "react-toastify";

export const useSettings = () => {
    const [paymentSettings, setPaymentSettings] = useState({
        whatsappPayment: true,
        razorpayPayment: true,
        codPayment: true,
    });
    const [invoiceSettings, setInvoiceSettings] = useState({
        companyName: "",
        address: "",
        mobile: "",
        email: "",
        gstin: "",
        state: "",
        website: "",
        footerTitle: "Thank You!",
        footerSubNote: "",
        supportEmail: "",
        supportPhone: "",
        upiId: "",
        logo: "",
    });
    const [shippingSettings, setShippingSettings] = useState({
        freeShippingThreshold: 500,
        shippingCost: 49,
    });
    const [gstSettings, setGstSettings] = useState({ gstEnabled: true });
    const [loading, setLoading] = useState(true);
    const [savingPayment, setSavingPayment] = useState(false);
    const [savingInvoice, setSavingInvoice] = useState(false);
    const [savingShipping, setSavingShipping] = useState(false);
    const [savingGst, setSavingGst] = useState(false);

    useEffect(() => {
        let active = true;
        const loadSettings = async () => {
            try {
                setLoading(true);
                const [payData, invData, shipData, gstData] = await Promise.all([
                    getPaymentSettings(),
                    getInvoiceSettings(),
                    getShippingSettings(),
                    getGstSettings(),
                ]);
                if (active) {
                    setPaymentSettings(payData);
                    setInvoiceSettings(invData);
                    setShippingSettings(shipData);
                    setGstSettings(gstData);
                }
            } catch (error) {
                console.error("Error loading settings:", error);
                toast.error("Failed to load settings.");
            } finally {
                if (active) {
                    setLoading(false);
                }
            }
        };
        loadSettings();
        return () => {
            active = false;
        };
    }, []);

    const updatePaymentSettings = async (newPay) => {
        try {
            setSavingPayment(true);
            await savePaymentSettings(newPay);
            setPaymentSettings(newPay);
            toast.success("Settings Saved Successfully");
            return true;
        } catch (error) {
            console.error("Error saving payment settings:", error);
            toast.error("Failed to save payment settings.");
            return false;
        } finally {
            setSavingPayment(false);
        }
    };

    const updateInvoiceSettings = async (newInv) => {
        if (!newInv.companyName?.trim()) {
            toast.error("Company Name is required.");
            return false;
        }
        try {
            setSavingInvoice(true);
            await saveInvoiceSettings(newInv);
            setInvoiceSettings(newInv);
            toast.success("Settings Saved Successfully");
            return true;
        } catch (error) {
            console.error("Error saving invoice settings:", error);
            toast.error("Failed to save invoice settings.");
            return false;
        } finally {
            setSavingInvoice(false);
        }
    };

    const updateShippingSettings = async (newShip) => {
        try {
            setSavingShipping(true);
            await saveShippingSettings(newShip);
            setShippingSettings(newShip);
            toast.success("Shipping settings saved successfully");
            return true;
        } catch (error) {
            console.error("Error saving shipping settings:", error);
            toast.error("Failed to save shipping settings.");
            return false;
        } finally {
            setSavingShipping(false);
        }
    };

    const updateGstSettings = async (newGst) => {
        try {
            setSavingGst(true);
            await saveGstSettings(newGst);
            setGstSettings(newGst);
            toast.success("GST settings saved successfully");
            return true;
        } catch (error) {
            console.error("Error saving GST settings:", error);
            toast.error("Failed to save GST settings.");
            return false;
        } finally {
            setSavingGst(false);
        }
    };

    return {
        paymentSettings,
        invoiceSettings,
        shippingSettings,
        gstSettings,
        loading,
        savingPayment,
        savingInvoice,
        savingShipping,
        savingGst,
        updatePaymentSettings,
        updateInvoiceSettings,
        updateShippingSettings,
        updateGstSettings,
    };
};