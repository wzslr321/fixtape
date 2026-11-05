export const order = {
  items: [
    { name: 'Pencil', sku: 'SKU-0110', price: 0.1 },
    { name: 'Eraser', sku: 'SKU-0220', price: 0.2 },
  ],
};

export function renderOrder(order) {
  document.querySelector('#items').replaceChildren(...order.items.map((item) => {
    const row = document.createElement('li');
    row.className = 'item';

    const content = document.createElement('div');
    content.className = 'item-content';
    const name = document.createElement('p');
    name.className = 'item-name';
    name.textContent = item.name;
    const sku = document.createElement('p');
    sku.className = 'item-sku';
    sku.textContent = item.sku;
    content.append(name, sku);

    const price = document.createElement('span');
    price.className = 'item-price';
    price.textContent = `$${item.price.toFixed(2)}`;
    row.append(content, price);
    return row;
  }));
  document.querySelector('#item-count').textContent = `${order.items.length} items`;
}

export function placeOrder(amount) {
  const button = document.querySelector('#place-order');
  button.disabled = true;
  button.textContent = 'Placed';
  document.querySelector('#charged').textContent = amount;
  document.querySelector('#confirmation').hidden = false;
}
