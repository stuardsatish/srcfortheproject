import ExpandablePanel from "../../components/Common/ExpandablePanel"

const ExpandablePanelDemo = () => {
  return (
    <div className="max-w-2xl mx-auto py-12 px-4">
      <h2 className="text-2xl font-bold text-white mb-6">Expandable Panel Demo</h2>
     
      <ExpandablePanel title="What is Melt?" defaultOpen={true}>
        <p className="text-gray-300">
          Melt is a premium chocolate brand crafted with the finest ingredients.
        </p>
      </ExpandablePanel>

      <ExpandablePanel title="Our Flavors">
        <p className="text-gray-300">
          We offer Crispy Caramel, Dark Cocoa, Orange Zest Milk, and Almond Crunch.
        </p>
      </ExpandablePanel>

      <ExpandablePanel title="How to Order">
        <p className="text-gray-300">
          Browse our products page and add items to your cart.
        </p>
      </ExpandablePanel>
    </div>
  )
}

export default ExpandablePanelDemo