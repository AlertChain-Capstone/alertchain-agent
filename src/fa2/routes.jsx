import Fa2App from './Fa2App.jsx'

export default {
  Component: Fa2App,
  routes: [
    { path: '/investigations', view: 'home' },
    { path: '/investigations/:id', view: 'investigation' },
    { path: '/incidents/:id/chain', view: 'chain' },
  ],
}
