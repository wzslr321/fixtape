export const tasks = [
  { title: 'Fix the empty search state', context: 'TASK-024', done: true },
  { title: 'Keep keyboard focus in the dialog', context: 'TASK-025', done: false },
  { title: 'Remember the selected theme', context: 'TASK-026', done: false },
];

export function renderTasks(visibleTasks) {
  document.querySelector('#tasks').replaceChildren(...visibleTasks.map((task) => {
    const row = document.createElement('li');
    row.className = `task${task.done ? ' completed' : ''}`;

    const status = document.createElement('span');
    status.className = 'task-status';
    status.setAttribute('aria-hidden', 'true');

    const content = document.createElement('div');
    content.className = 'task-content';
    const title = document.createElement('p');
    title.className = 'task-title';
    title.textContent = task.title;
    const context = document.createElement('p');
    context.className = 'task-context';
    context.textContent = task.context;
    content.append(title, context);

    const badge = document.createElement('span');
    badge.className = 'task-badge';
    badge.textContent = task.done ? 'Completed' : 'To do';
    row.append(status, content, badge);
    return row;
  }));
  document.querySelector('#task-count').textContent = `${visibleTasks.length} tasks`;
}
