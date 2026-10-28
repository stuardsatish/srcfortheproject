import { FaInstagram, FaFacebookF, FaYoutube, FaWhatsapp } from "react-icons/fa"
import { Link } from "react-router-dom"

const Footer = () => {
    return (
        <footer className="bg-surface mt-20 border-t border-error-border">

            <div className="max-w-7xl mx-auto px-6 md:px-8 py-10 md:py-16 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-8 md:gap-12">

                {/* Brand Section */}
                <div className="text-center md:text-left sm:col-span-2 md:col-span-1">
                    <h3 className="text-2xl font-bold text-ink mb-4">
                        Sweet Delights
                    </h3>
                    <p className="text-muted leading-relaxed">
                        Crafted with love and the finest ingredients, bringing
                        sweetness to your celebrations and everyday moments.
                    </p>
                </div>

                {/* Quick Links */}
                <div className="text-center md:text-left">
                    <h4 className="text-lg font-semibold text-ink mb-4">
                        Quick Links
                    </h4>
                    <ul className="space-y-3 text-muted">
                        <li className="min-h-[44px] flex items-center justify-center md:justify-start"><Link to="/" className="hover:text-error transition">Home</Link></li>
                        <li className="min-h-[44px] flex items-center justify-center md:justify-start"><Link to="/products" className="hover:text-error transition">Products</Link></li>
                        <li className="min-h-[44px] flex items-center justify-center md:justify-start"><Link to="/help" className="hover:text-error transition">Help Center</Link></li>
                        <li className="min-h-[44px] flex items-center justify-center md:justify-start"><Link to="/contact" className="hover:text-error transition">Contact Us</Link></li>
                    </ul>
                </div>

                {/* Policies */}
                <div className="text-center md:text-left">
                    <h4 className="text-lg font-semibold text-ink mb-4">
                        Policies
                    </h4>
                    <ul className="space-y-3 text-muted">
                        <li className="min-h-[44px] flex items-center justify-center md:justify-start">
                            <Link to="/privacy-policy" className="hover:text-error transition">Privacy Policy</Link>
                        </li>
                        <li className="min-h-[44px] flex items-center justify-center md:justify-start">
                            <Link to="/refund-policy" className="hover:text-error transition">Refund Policy</Link>
                        </li>
                        <li className="min-h-[44px] flex items-center justify-center md:justify-start">
                            <Link to="/terms-conditions" className="hover:text-error transition">Terms &amp; Conditions</Link>
                        </li>
                        <li className="min-h-[44px] flex items-center justify-center md:justify-start">
                            <Link to="/shipping-policy" className="hover:text-error transition">Shipping Policy</Link>
                        </li>
                    </ul>
                </div>

                {/* Contact & Social */}
                <div className="text-center md:text-left">
                    <h4 className="text-lg font-semibold text-ink mb-4">
                        Get In Touch
                    </h4>

                    <p className="text-muted mb-4">
                        Chennai, India
                        <br />
                        +91 98765 43210
                        <br />
                        sweets@example.com
                    </p>

                    <div className="flex gap-4 text-muted justify-center md:justify-start">
                        <FaInstagram className="cursor-pointer hover:text-primary transition text-xl" />
                        <FaFacebookF className="cursor-pointer hover:text-link transition text-xl" />
                        <FaYoutube className="cursor-pointer hover:text-error transition text-xl" />
                        <FaWhatsapp className="cursor-pointer hover:text-success transition text-xl" />
                    </div>
                </div>

            </div>

            {/* Bottom Bar */}
            <div className="border-t border-error-border py-6 text-center text-muted text-sm px-6">
                © {new Date().getFullYear()} Sweet Delights. All rights reserved.
            </div>

        </footer>
    )
}

export default Footer