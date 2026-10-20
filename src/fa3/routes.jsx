import Fa3App from './Fa3App.jsx'

export default {
  Component: Fa3App,
  routes: [
    { path: '/', view: 'dashboard' },
    { path: '/incidents', view: 'list' },
    { path: '/incidents/:id', view: 'report' },
    { path: '/incidents/:id/ask', view: 'ask' },
  ],
}
