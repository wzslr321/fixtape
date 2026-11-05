import { tasks, renderTasks } from '/tasks.js';

renderTasks(tasks);
document.querySelector('#hide-completed').addEventListener('change', () => {
  renderTasks(tasks);
});
