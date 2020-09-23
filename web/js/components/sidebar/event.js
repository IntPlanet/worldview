import React, { useEffect } from 'react';
import PropTypes from 'prop-types';
import lodashFind from 'lodash/find';
import googleTagManager from 'googleTagManager';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faExternalLinkAlt } from '@fortawesome/free-solid-svg-icons';
import util from '../../util/util';

function Event (props) {
  const {
    deselectEvent,
    event,
    isSelected,
    selectedDate,
    selectEvent,
    sources,
    isVisible,
  } = props;
  const ref = React.createRef();
  const eventDate = util.parseDateUTC(event.geometry[0].date);
  let dateString = `${util.giveWeekDay(eventDate)}, ${util.giveMonth(eventDate)} ${eventDate.getUTCDate()}`;
  if (eventDate.getUTCFullYear() !== util.today().getUTCFullYear()) {
    dateString += `, ${eventDate.getUTCFullYear()}`;
  }
  // eslint-disable-next-line no-nested-ternary
  const itemClass = isSelected
    ? 'item-selected selectorItem item item-visible'
    : isVisible
      ? 'selectorItem item'
      : 'selectorItem item hidden';

  useEffect(() => {
    if (isSelected) {
      ref.current.scrollIntoView({
        block: 'start',
        inline: 'nearest',
        behavior: 'smooth',
      });
    }
  }, [isSelected]);

  /**
   * Return date list for selected event
   */
  function getDateLists() {
    if (event.geometry.length > 1) {
      return (
        <ul
          className="dates"
          style={!isSelected ? { display: 'none' } : { display: 'block' }}
        >
          {event.geometry.map((geometry, index) => {
            const date = geometry.date.split('T')[0];
            return (
              <li key={`${event.id}-${date}`} className="dates">
                <a
                  onClick={(e) => {
                    e.stopPropagation();
                    onClick(date);
                  }}
                  className={
                    selectedDate === date
                      ? 'date item-selected active'
                      : 'date item-selected '
                  }
                >
                  {date}
                </a>
              </li>
            );
          })}
        </ul>
      );
    }
  }

  /**
   *
   * @param {String} date | Date of event clicked
   * @param {Boolean} isSelected | Is this event already selected
   * @param {Object} e | Event Object
   */
  function onClick(date) {
    if (isSelected && (!date || date === selectedDate)) {
      deselectEvent();
    } else {
      selectEvent(event.id, date);
      googleTagManager.pushEvent({
        event: 'natural_event_selected',
        natural_events: {
          category: event.categories[0].title,
        },
      });
    }
  }

  /**
   * Return reference list for an event
   */
  function getReferenceList() {
    if (!isSelected) return;

    const references = Array.isArray(event.sources)
      ? event.sources
      : [event.sources];
    if (references.length > 0) {
      return references.map((reference) => {
        const source = lodashFind(sources, {
          id: reference.id,
        });
        if (reference.url) {
          return (
            <a
              target="_blank"
              rel="noopener noreferrer"
              className="natural-event-link"
              href={reference.url}
              key={`${event.id}-${reference.id}`}
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              <FontAwesomeIcon icon={faExternalLinkAlt} />
              {` ${source.title}`}
            </a>
          );
        }
        return `${source.title} `;
      });
    }
  }

  return (
    <li
      id={`sidebar-event-${util.encodeId(event.id)}`}
      ref={ref}
      className={itemClass}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <i
        className={`event-icon event-icon-${event.categories[0].slug}`}
        title={event.categories[0].title}
      />
      <h4
        className="title"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: `${event.title}<br />${dateString}` }}
      />
      <p className="subtitle">{getReferenceList()}</p>
      {getDateLists()}
    </li>
  );
}

Event.propTypes = {
  deselectEvent: PropTypes.func,
  event: PropTypes.object,
  isSelected: PropTypes.bool,
  isVisible: PropTypes.bool,
  selectedDate: PropTypes.string,
  selectEvent: PropTypes.func,
  sources: PropTypes.array,
};

export default Event;
