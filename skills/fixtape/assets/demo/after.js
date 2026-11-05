import { tasks, renderTasks } from '/tasks.js';

renderTasks(tasks);
document.querySelector('#hide-completed').addEventListener('change', (event) => {
  const visibleTasks = event.target.checked ? tasks.filter((task) => !task.done) : tasks;
  renderTasks(visibleTasks);
});
